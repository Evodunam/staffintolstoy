import { Client } from "pg";

type Edge = { child: string; parent: string };

function qIdent(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

function topoSortTables(tables: string[], edges: Edge[]): string[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, Set<string>>();

  for (const t of tables) {
    incoming.set(t, 0);
    outgoing.set(t, new Set());
  }

  for (const { child, parent } of edges) {
    if (!incoming.has(child) || !incoming.has(parent)) continue;
    outgoing.get(parent)!.add(child);
    incoming.set(child, (incoming.get(child) ?? 0) + 1);
  }

  const queue: string[] = tables.filter((t) => (incoming.get(t) ?? 0) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const dep of outgoing.get(node) ?? []) {
      const nextIn = (incoming.get(dep) ?? 0) - 1;
      incoming.set(dep, nextIn);
      if (nextIn === 0) queue.push(dep);
    }
  }

  // For cycles, append remaining nodes in stable order.
  if (result.length < tables.length) {
    const remaining = tables.filter((t) => !result.includes(t));
    result.push(...remaining);
  }

  return result;
}

function toInsertSql(table: string, columns: string[], rowCount: number): string {
  const colList = columns.map(qIdent).join(", ");
  const valuesChunks: string[] = [];
  let param = 1;

  for (let r = 0; r < rowCount; r++) {
    const placeholders: string[] = [];
    for (let c = 0; c < columns.length; c++) {
      placeholders.push(`$${param++}`);
    }
    valuesChunks.push(`(${placeholders.join(", ")})`);
  }

  return `INSERT INTO ${qIdent(table)} (${colList}) VALUES ${valuesChunks.join(", ")};`;
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;

  if (!sourceUrl) throw new Error("Missing SOURCE_DATABASE_URL");
  if (!targetUrl) throw new Error("Missing TARGET_DATABASE_URL");

  const source = new Client({ connectionString: sourceUrl });
  const target = new Client({ connectionString: targetUrl });

  await source.connect();
  await target.connect();

  try {
    const tableRes = await source.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tables = tableRes.rows.map((r) => r.table_name);

    if (tables.length === 0) {
      console.log("No tables found in source DB.");
      return;
    }

    const fkRes = await source.query<{ child: string; parent: string }>(`
      SELECT
        child.relname AS child,
        parent.relname AS parent
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      WHERE con.contype = 'f'
        AND child_ns.nspname = 'public'
        AND parent_ns.nspname = 'public';
    `);

    const ordered = topoSortTables(tables, fkRes.rows);
    console.log(`Found ${tables.length} tables. Migrating in dependency order...`);

    await target.query("BEGIN");
    for (const table of tables) {
      await target.query(`TRUNCATE TABLE ${qIdent(table)} RESTART IDENTITY CASCADE;`);
    }
    await target.query("COMMIT");
    console.log("Target tables truncated.");

    const pending = [...ordered];
    let pass = 1;
    while (pending.length > 0) {
      let progressed = 0;
      const nextPending: string[] = [];
      console.log(`Migration pass ${pass}: ${pending.length} table(s) pending`);

      for (const table of pending) {
        const colRes = await source.query<{ column_name: string }>(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position;
          `,
          [table],
        );
        const sourceColumns = colRes.rows.map((r) => r.column_name);
        if (sourceColumns.length === 0) {
          progressed++;
          continue;
        }

        const targetColRes = await target.query<{ column_name: string }>(
          `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position;
          `,
          [table],
        );
        const targetColumns = targetColRes.rows.map((r) => r.column_name);
        if (targetColumns.length === 0) {
          console.log(`- ${table}: skipped (table not present in target schema)`);
          progressed++;
          continue;
        }

        const columns = sourceColumns.filter((c) => targetColumns.includes(c));
        if (columns.length === 0) {
          console.log(`- ${table}: skipped (no shared columns with target schema)`);
          progressed++;
          continue;
        }

        const selectCols = columns.map(qIdent).join(", ");
        const dataRes = await source.query(`SELECT ${selectCols} FROM ${qIdent(table)};`);
        const rows = dataRes.rows;
        if (rows.length === 0) {
          console.log(`- ${table}: 0 rows`);
          progressed++;
          continue;
        }

        try {
          await target.query("BEGIN");
          const batchSize = 200;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const sql = toInsertSql(table, columns, batch.length);
            const params: unknown[] = [];
            for (const row of batch) {
              for (const col of columns) params.push(row[col]);
            }
            await target.query(sql, params);
          }
          await target.query("COMMIT");
          console.log(`- ${table}: ${rows.length} rows`);
          progressed++;
        } catch (err: any) {
          await target.query("ROLLBACK");
          if (err?.code === "23503") {
            nextPending.push(table);
            continue;
          }
          throw err;
        }
      }

      if (nextPending.length > 0 && progressed === 0) {
        throw new Error(
          `Could not resolve FK order for tables: ${nextPending.join(", ")}`,
        );
      }

      pending.splice(0, pending.length, ...nextPending);
      pass++;
    }

    // Reset owned sequences to max existing value.
    await target.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT
            n.nspname AS schema_name,
            t.relname AS table_name,
            a.attname AS column_name,
            s.relname AS sequence_name
          FROM pg_class s
          JOIN pg_depend d ON d.objid = s.oid
          JOIN pg_class t ON d.refobjid = t.oid
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE s.relkind = 'S' AND n.nspname = 'public'
        LOOP
          EXECUTE format(
            'SELECT setval(%L, COALESCE(MAX(%I), 1), COALESCE(MAX(%I), 1) IS NOT NULL) FROM %I.%I',
            r.sequence_name,
            r.column_name,
            r.column_name,
            r.schema_name,
            r.table_name
          );
        END LOOP;
      END $$;
    `);

    console.log("Sequence values synchronized.");
    console.log("Migration completed successfully.");
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

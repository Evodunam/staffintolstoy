/**
 * Audit Row-Level Security state on every public table.
 *
 * Why this exists: migrations 043-045 disabled RLS on a handful of tables
 * (users, sessions, profiles, company_locations, ...) because Neon's pooler
 * (PgBouncer in transaction mode) leaks session GUCs across pooled
 * connections, causing INSERT/UPDATE to fail with
 *   "new row violates row-level security policy"
 * on a "dirty" pooled client. Any other table that still has RLS enabled
 * with a USING/WITH CHECK clause depending on `current_setting('app.user_id')`
 * is going to break writes intermittently in prod.
 *
 * This script prints per-table:
 *   - whether RLS is enabled
 *   - whether RLS is FORCEd (applies to table owner too)
 *   - the policies and their qual/with_check expressions
 *
 * Usage:
 *   dotenv -e .env.production -- tsx script/check-rls-state.ts
 *   dotenv -e .env.development -- tsx script/check-rls-state.ts
 *
 * Read-only. No modifications.
 */
import pg from "pg";
const { Pool } = pg;

interface TableRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
}
interface PolicyRow {
  table_name: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
  roles: string[] | null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: dbUrl });
  try {
    const tables = await pool.query<TableRow>(`
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
      ORDER BY c.relname
    `);

    const policies = await pool.query<PolicyRow>(`
      SELECT
        tablename AS table_name,
        policyname,
        cmd,
        qual,
        with_check,
        roles
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);

    const enabled = tables.rows.filter((t) => t.rls_enabled);
    const disabled = tables.rows.filter((t) => !t.rls_enabled);

    console.log(`\nRLS audit (DB: ${maskDbUrl(dbUrl)})`);
    console.log(`  total tables in public:      ${tables.rows.length}`);
    console.log(`  RLS enabled:                 ${enabled.length}`);
    console.log(`  RLS disabled:                ${disabled.length}`);
    console.log(`  total policies in public:    ${policies.rows.length}\n`);

    if (enabled.length > 0) {
      console.log("Tables with RLS still ENABLED:");
      for (const t of enabled) {
        const tbPolicies = policies.rows.filter((p) => p.table_name === t.table_name);
        const flags = [t.rls_forced ? "FORCED" : ""].filter(Boolean).join(",");
        console.log(`  ${t.table_name}${flags ? ` [${flags}]` : ""}  (${tbPolicies.length} polic${tbPolicies.length === 1 ? "y" : "ies"})`);
        for (const p of tbPolicies) {
          const rolesStr = p.roles ? `to=${p.roles.join(",")}` : "";
          console.log(`     - ${p.policyname}  cmd=${p.cmd}  ${rolesStr}`);
          if (p.qual) console.log(`         USING(${oneLine(p.qual)})`);
          if (p.with_check) console.log(`         WITH CHECK(${oneLine(p.with_check)})`);
        }
      }
      console.log("");
      // Highlight policies that depend on current_setting() — those are the
      // Neon-pooler-leak landmines.
      const guc = policies.rows.filter(
        (p) =>
          (p.qual && p.qual.includes("current_setting")) ||
          (p.with_check && p.with_check.includes("current_setting")),
      );
      if (guc.length > 0) {
        console.log("⚠ Policies depending on current_setting() (Neon GUC-leak landmines):");
        for (const p of guc) {
          console.log(`  ${p.table_name}.${p.policyname} (${p.cmd})`);
        }
        console.log(
          "\nThese will intermittently 'new row violates row-level security' on Neon's pooler.\n" +
          "Either disable RLS on these tables or refactor attachRlsDbContext to use\n" +
          "transaction-local SET LOCAL inside an explicit BEGIN/COMMIT.\n",
        );
      } else {
        console.log("(no current_setting()-dependent policies — RLS is harmless here.)");
      }
    } else {
      console.log("No tables have RLS enabled. Nothing to audit.");
    }
  } finally {
    await pool.end();
  }
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
function maskDbUrl(url: string): string {
  return url.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

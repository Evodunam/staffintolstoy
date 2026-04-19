/**
 * Idempotent production-migration runner.
 *
 * Why this exists: drizzle-kit push works for greenfield/dev but is risky
 * against prod (it diffs LIVE schema, not a journal). For prod we want:
 *   1. A persistent record of which numbered SQL files have been applied.
 *   2. Exactly-once execution (re-run is safe — already-applied files skip).
 *   3. Per-file transactions so a failure rolls back cleanly.
 *
 * Usage:
 *   npm run migrate:prod                                          # dry-run: lists pending migrations
 *   npm run migrate:prod -- --apply                               # apply ALL pending
 *   npm run migrate:prod -- --apply --from 046                    # only files >= 046
 *   npm run migrate:prod -- --apply --from 055 --to 060           # only 055..060
 *   npm run migrate:prod -- --apply --file 062_disable_rls_remaining_tables.sql
 *                                                                 # apply exactly one file
 *   npm run migrate:prod -- --apply --file 062_X.sql --file 064_Y.sql
 *                                                                 # apply two specific files
 *
 * Tracking table (auto-created if missing):
 *   _schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)
 *
 * Safe to point at dev too — the table is per-database. Production runs
 * MUST go through .env.production:
 *   dotenv -e .env.production -- tsx script/migrate-prod.ts -- --apply
 */
import pg from "pg";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

const { Pool } = pg;

/**
 * Neon-specific connection rewrite.
 *
 * Neon offers two endpoint variants per branch:
 *   - DIRECT  (e.g. ep-misty-salad-aje4lu09.c-3.us-east-2.aws.neon.tech)
 *   - POOLED  (e.g. ep-misty-salad-aje4lu09-pooler.c-3.us-east-2.aws.neon.tech)
 *
 * App traffic should hit -pooler (PgBouncer transaction mode) for safe
 * connection scaling. Migrations should hit the DIRECT endpoint because:
 *   1. PgBouncer transaction mode breaks CREATE INDEX CONCURRENTLY, advisory
 *      locks held across statements, prepared statements, SET (session-level),
 *      and large DDL transactions that span multiple statements.
 *   2. Some `ALTER TABLE ... ADD CONSTRAINT` validations need a session-stable
 *      catalog snapshot the pooler can't guarantee.
 *
 * We auto-strip "-pooler" from the hostname so the user can keep DATABASE_URL
 * pointed at the pooled endpoint for the app and the migrator just does the
 * right thing. Override with MIGRATIONS_DATABASE_URL if you have a different
 * direct endpoint (e.g. a separate Neon branch for migrations).
 */
function rewriteForMigrations(url: string): string {
  if (process.env.MIGRATIONS_DATABASE_URL) {
    return process.env.MIGRATIONS_DATABASE_URL;
  }
  // Replace `<endpoint>-pooler.<rest>` -> `<endpoint>.<rest>` (Neon convention).
  // Only rewrite if it actually looks like a Neon hostname.
  if (/\.neon\.tech/.test(url)) {
    return url.replace(/-pooler(\.[^@/]+\.neon\.tech)/, "$1");
  }
  return url;
}

function maskDbUrl(url: string): string {
  return url.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
}

/** Run a query with a single retry to absorb Neon scale-from-zero cold starts. */
async function withColdStartRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const looksLikeColdStart =
      msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("Connection terminated unexpectedly") ||
      msg.includes("Endpoint is in transition");
    if (!looksLikeColdStart) throw e;
    console.warn(`  retry ${label} after Neon cold-start: ${msg}`);
    await new Promise((r) => setTimeout(r, 2_000));
    return await fn();
  }
}

interface Args {
  apply: boolean;
  from?: string;
  to?: string;
  only?: string;
  /** Repeatable: --file 062_disable_rls_remaining_tables.sql --file 064_other.sql */
  files: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { apply: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--only") args.only = argv[++i];
    else if (a === "--file") args.files.push(argv[++i]);
  }
  return args;
}

function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // numeric prefix gives us natural order: 001_*.sql, 002_*.sql, ...
}

function fileNumberPrefix(filename: string): string {
  const m = /^(\d+)_/.exec(filename);
  return m ? m[1] : "";
}

async function main() {
  const args = parseArgs();
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    console.error("DATABASE_URL not set. Run with `dotenv -e .env.production -- tsx script/migrate-prod.ts ...`");
    process.exit(1);
  }
  const dbUrl = rewriteForMigrations(rawDbUrl);
  const usingDirect = dbUrl !== rawDbUrl;

  const migrationsDir = resolve(process.cwd(), "migrations");
  const allFiles = listMigrationFiles(migrationsDir);

  // max=1 keeps DDL on a single backend session — no PgBouncer surprises and
  // no parallel query interference. Migrations are inherently sequential.
  // statement_timeout caps any one statement at 5 minutes so a runaway DDL
  // doesn't hold the connection forever.
  const pool = new Pool({
    connectionString: dbUrl,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 30_000, // generous for Neon cold-start
    statement_timeout: 5 * 60 * 1000,
  } as any);

  try {
    await withColdStartRetry("create _schema_migrations", () =>
      pool.query(`
        CREATE TABLE IF NOT EXISTS _schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        );
      `),
    );

    const { rows: appliedRows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM _schema_migrations",
    );
    const applied = new Set(appliedRows.map((r) => r.filename));

    const filtered = allFiles.filter((f) => {
      // --file <name> wins over all other filters (allows applying exactly one
      // when multiple files share a numeric prefix, e.g. 062_X.sql and 062_Y.sql).
      if (args.files.length > 0) return args.files.includes(f);
      const n = fileNumberPrefix(f);
      if (args.only) return n === args.only;
      if (args.from && n < args.from) return false;
      if (args.to && n > args.to) return false;
      return true;
    });

    const pending = filtered.filter((f) => !applied.has(f));

    console.log(`\nMigration plan`);
    console.log(`  DB:                   ${maskDbUrl(dbUrl)}`);
    if (usingDirect) {
      console.log(`  endpoint rewrite:     -pooler stripped (using DIRECT for safer DDL)`);
    }
    console.log(`  files in migrations/: ${allFiles.length}`);
    console.log(`  filtered:             ${filtered.length}`);
    console.log(`  already applied:      ${filtered.length - pending.length}`);
    console.log(`  pending:              ${pending.length}\n`);

    if (pending.length === 0) {
      console.log("Nothing to do. All filtered migrations are already applied.");
      return;
    }

    for (const f of pending) {
      const marker = applied.has(f) ? "[applied]" : "[pending]";
      console.log(`  ${marker} ${f}`);
    }

    if (!args.apply) {
      console.log("\nDry-run only. Re-run with --apply to execute pending migrations.");
      return;
    }

    console.log("\nApplying...\n");
    for (const f of pending) {
      const sql = readFileSync(join(migrationsDir, f), "utf-8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO _schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
          [f],
        );
        await client.query("COMMIT");
        console.log(`  ok   ${f}`);
      } catch (err: any) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`  FAIL ${f}: ${err?.message ?? err}`);
        throw err; // stop on first failure — rest of pending are not applied
      } finally {
        client.release();
      }
    }
    console.log("\nAll pending migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migrator failed:", err?.message ?? err);
  process.exit(1);
});

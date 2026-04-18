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
 *   npm run migrate:prod                 # dry-run: lists pending migrations
 *   npm run migrate:prod -- --apply      # actually applies pending migrations
 *   npm run migrate:prod -- --apply --from 046  # only files >= 046
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

interface Args {
  apply: boolean;
  from?: string;
  to?: string;
  only?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--from") args.from = argv[++i];
    else if (a === "--to") args.to = argv[++i];
    else if (a === "--only") args.only = argv[++i];
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
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set. Run with `dotenv -e .env.production -- tsx script/migrate-prod.ts ...`");
    process.exit(1);
  }

  const migrationsDir = resolve(process.cwd(), "migrations");
  const allFiles = listMigrationFiles(migrationsDir);

  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const { rows: appliedRows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM _schema_migrations",
    );
    const applied = new Set(appliedRows.map((r) => r.filename));

    const filtered = allFiles.filter((f) => {
      const n = fileNumberPrefix(f);
      if (args.only) return n === args.only;
      if (args.from && n < args.from) return false;
      if (args.to && n > args.to) return false;
      return true;
    });

    const pending = filtered.filter((f) => !applied.has(f));

    console.log(`\nMigration plan (DB: ${maskDbUrl(dbUrl)})`);
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

function maskDbUrl(url: string): string {
  return url.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
}

main().catch((err) => {
  console.error("Migrator failed:", err?.message ?? err);
  process.exit(1);
});

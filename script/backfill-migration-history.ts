/**
 * Mark a range of migrations as already applied WITHOUT running them.
 * Use this once on a database that pre-dates the _schema_migrations table.
 *
 * Heuristic: any numbered migration file whose tables/columns already exist
 * in the live schema can be marked applied. Manual review preferred — pass
 * --through 054 to mark 001..054 as applied (the cutover point for this app
 * is migration 054, the last one in the megacommit).
 *
 * Usage:
 *   dotenv -e .env.production -- tsx script/backfill-migration-history.ts --through 054
 *   dotenv -e .env.production -- tsx script/backfill-migration-history.ts --through 054 --commit
 */
import pg from "pg";
import { readdirSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

function parseArgs() {
  const argv = process.argv.slice(2);
  let through = "";
  let commit = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--through") through = argv[++i];
    else if (argv[i] === "--commit") commit = true;
  }
  return { through, commit };
}

async function main() {
  const { through, commit } = parseArgs();
  if (!through) {
    console.error("Pass --through <migration_number> (e.g. --through 054).");
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }

  const migrationsDir = resolve(process.cwd(), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const target = files.filter((f) => {
    const m = /^(\d+)_/.exec(f);
    return m && m[1] <= through;
  });

  console.log(`Will mark ${target.length} migrations as applied (<=${through}):`);
  for (const f of target) console.log(`  ${f}`);

  if (!commit) {
    console.log("\nDry-run. Re-run with --commit to write to _schema_migrations.");
    return;
  }

  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    for (const f of target) {
      await pool.query(
        "INSERT INTO _schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
        [f],
      );
    }
    console.log(`\nMarked ${target.length} migrations as applied.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

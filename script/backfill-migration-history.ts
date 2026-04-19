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
  let unmarkFrom = "";
  let unmarkTo = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--through") through = argv[++i];
    else if (argv[i] === "--commit") commit = true;
    else if (argv[i] === "--unmark-from") unmarkFrom = argv[++i];
    else if (argv[i] === "--unmark-to") unmarkTo = argv[++i];
  }
  return { through, commit, unmarkFrom, unmarkTo };
}

function rewriteForMigrations(url: string): string {
  if (process.env.MIGRATIONS_DATABASE_URL) return process.env.MIGRATIONS_DATABASE_URL;
  if (/\.neon\.tech/.test(url)) {
    return url.replace(/-pooler(\.[^@/]+\.neon\.tech)/, "$1");
  }
  return url;
}

async function main() {
  const { through, commit, unmarkFrom, unmarkTo } = parseArgs();
  const isUnmark = !!(unmarkFrom || unmarkTo);
  if (!through && !isUnmark) {
    console.error("Pass --through <N> to mark, OR --unmark-from <N> --unmark-to <N> to unmark.");
    console.error("");
    console.error("Examples:");
    console.error("  --through 054                       # mark 001..054 as applied");
    console.error("  --unmark-from 046 --unmark-to 054   # delete 046..054 from history");
    console.error("                                       # (use when a backfill was wrong)");
    process.exit(1);
  }
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }
  const dbUrl = rewriteForMigrations(rawDbUrl);

  const migrationsDir = resolve(process.cwd(), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pool = new Pool({
    connectionString: dbUrl,
    max: 1,
    connectionTimeoutMillis: 30_000,
  } as any);
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    if (isUnmark) {
      const target = files.filter((f) => {
        const m = /^(\d+)_/.exec(f);
        if (!m) return false;
        if (unmarkFrom && m[1] < unmarkFrom) return false;
        if (unmarkTo && m[1] > unmarkTo) return false;
        return true;
      });
      console.log(`Will UNMARK ${target.length} migrations (delete from _schema_migrations):`);
      for (const f of target) console.log(`  ${f}`);
      if (!commit) {
        console.log("\nDry-run. Re-run with --commit to actually delete the rows.");
        return;
      }
      let deleted = 0;
      for (const f of target) {
        const r = await pool.query("DELETE FROM _schema_migrations WHERE filename = $1", [f]);
        deleted += r.rowCount ?? 0;
      }
      console.log(`\nUnmarked ${deleted} migrations. They are now pending again -- re-run migrate:prod to see.`);
      return;
    }

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

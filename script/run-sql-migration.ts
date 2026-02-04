/**
 * Run a SQL migration file using DATABASE_URL (env or second argument).
 * Usage:
 *   npx tsx script/run-sql-migration.ts migrations/005_add_company_onboarding_reminder_sent_at.sql
 *   npx tsx script/run-sql-migration.ts migrations/005_...sql "postgresql://user:pass@localhost:5432/dbname?sslmode=disable"
 * Or: set DATABASE_URL then run with just the migration path.
 */
import pg from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";

const { Pool } = pg;

function isConnectionString(s: string): boolean {
  return /^postgres(ql)?:\/\//i.test(s);
}

async function main() {
  const arg1 = process.argv[2];
  const arg2 = process.argv[3];
  const migrationPath = isConnectionString(arg1 ?? "") ? arg2 : arg1;
  const dbUrlOverride = isConnectionString(arg1 ?? "") ? arg1 : isConnectionString(arg2 ?? "") ? arg2 : undefined;

  const dbUrl = dbUrlOverride ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ DATABASE_URL is not set. Either:");
    console.error("   1. Set it in .env.development and run: npx dotenv -e .env.development -- tsx script/run-sql-migration.ts <migration.sql>");
    console.error("   2. Pass it as the second argument: npx tsx script/run-sql-migration.ts <migration.sql> \"postgresql://user:pass@localhost:5432/dbname?sslmode=disable\"");
    process.exit(1);
  }

  if (!migrationPath) {
    console.error("Usage: npx tsx script/run-sql-migration.ts <path-to-migration.sql> [DATABASE_URL]");
    process.exit(1);
  }

  const absolutePath = resolve(process.cwd(), migrationPath);
  let sql: string;
  try {
    sql = readFileSync(absolutePath, "utf-8");
  } catch (e) {
    console.error("❌ Failed to read migration file:", absolutePath, e);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query(sql);
    console.log("✅ Migration completed successfully:", migrationPath);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("❌ Migration failed:", msg);
    if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
      console.error("");
      console.error("   Could not resolve database host. Check DATABASE_URL:");
      console.error("   - For local PostgreSQL use: postgresql://USER:PASSWORD@localhost:5432/DATABASE_NAME?sslmode=disable");
      console.error("   - Fix the host in .env.development or pass URL: npx tsx script/run-sql-migration.ts " + migrationPath + " \"postgresql://...\"");
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

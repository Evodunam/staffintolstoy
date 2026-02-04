/**
 * Confirm PostgreSQL connection using DATABASE_URL.
 * Usage: npx dotenv -e .env.development -- npx tsx script/check-db-connection.ts
 *    or: npx dotenv -e .env.production -- npx tsx script/check-db-connection.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
import pg from "pg";

const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
config({ path: resolve(process.cwd(), envFile), override: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DATABASE_URL is not set. Check", envFile);
  process.exit(1);
}

// Redact password for log
const safeUrl = url.replace(/:([^@]+)@/, ":****@");
console.log("Checking PostgreSQL connection:", safeUrl);

const pool = new pg.Pool({ connectionString: url });

async function check() {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query("SELECT 1 as ok, current_database() as db, current_user as usr");
      const row = res.rows[0];
      console.log("✅ Connected to PostgreSQL");
      console.log("   Database:", row?.db);
      console.log("   User:", row?.usr);
    } finally {
      client.release();
    }
    await pool.end();
  } catch (err: any) {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  }
}

check();

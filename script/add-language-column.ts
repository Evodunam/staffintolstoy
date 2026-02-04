import { config } from "dotenv";
import { resolve } from "path";
import pg from "pg";

const { Client } = pg;

// Load environment variables
const envFile = resolve(process.cwd(), ".env.development");
config({ path: envFile });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not found in environment variables");
  process.exit(1);
}

async function addLanguageColumn() {
  const client = new Client({
    connectionString: DATABASE_URL,
  });

  try {
    await client.connect();
    console.log("✅ Connected to database");

    // Add the language column
    await client.query(`
      ALTER TABLE profiles 
      ADD COLUMN IF NOT EXISTS language TEXT;
    `);

    console.log("✅ Added 'language' column to profiles table");

    // Verify the column was added
    const result = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'profiles' AND column_name = 'language';
    `);

    if (result.rows.length > 0) {
      console.log("✅ Verified: language column exists");
      console.log(`   Column: ${result.rows[0].column_name}, Type: ${result.rows[0].data_type}`);
    } else {
      console.warn("⚠️  Warning: Could not verify column was added");
    }

    await client.end();
    console.log("✅ Migration complete!");
  } catch (error: any) {
    console.error("❌ Error adding language column:", error.message);
    await client.end();
    process.exit(1);
  }
}

addLanguageColumn();

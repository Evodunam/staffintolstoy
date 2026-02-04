import { config } from "dotenv";
import { resolve } from "path";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

// Load environment variables
const envFile = resolve(process.cwd(), ".env.development");
config({ path: envFile, override: true });

async function addStripeIdentityColumns() {
  try {
    console.log("🔄 Adding Stripe Identity verification columns to profiles table...");
    
    // Add stripe_identity_verification_id column
    const check1 = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'profiles' 
      AND column_name = 'stripe_identity_verification_id'
    `);
    
    if (!check1.rows || check1.rows.length === 0) {
      await db.execute(sql`
        ALTER TABLE profiles 
        ADD COLUMN stripe_identity_verification_id TEXT
      `);
      console.log("✅ Added stripe_identity_verification_id column");
    } else {
      console.log("✅ Column stripe_identity_verification_id already exists");
    }
    
    // Add identity_verified column
    const check2 = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'profiles' 
      AND column_name = 'identity_verified'
    `);
    
    if (!check2.rows || check2.rows.length === 0) {
      await db.execute(sql`
        ALTER TABLE profiles 
        ADD COLUMN identity_verified BOOLEAN DEFAULT FALSE
      `);
      console.log("✅ Added identity_verified column");
    } else {
      console.log("✅ Column identity_verified already exists");
    }
    
    // Add identity_verified_at column
    const check3 = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'profiles' 
      AND column_name = 'identity_verified_at'
    `);
    
    if (!check3.rows || check3.rows.length === 0) {
      await db.execute(sql`
        ALTER TABLE profiles 
        ADD COLUMN identity_verified_at TIMESTAMP
      `);
      console.log("✅ Added identity_verified_at column");
    } else {
      console.log("✅ Column identity_verified_at already exists");
    }
    
    // Add Google Business columns
    const googleColumns = [
      { name: 'google_business_access_token', type: 'TEXT' },
      { name: 'google_business_refresh_token', type: 'TEXT' },
      { name: 'google_business_token_expires_at', type: 'TIMESTAMP' },
      { name: 'google_business_location_id', type: 'TEXT' },
    ];
    
    for (const col of googleColumns) {
      const check = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'profiles' 
        AND column_name = ${col.name}
      `);
      
      if (!check.rows || check.rows.length === 0) {
        await db.execute(sql.raw(`
          ALTER TABLE profiles 
          ADD COLUMN ${col.name} ${col.type}
        `));
        console.log(`✅ Added ${col.name} column`);
      } else {
        console.log(`✅ Column ${col.name} already exists`);
      }
    }
    
    console.log("✅ All columns added successfully");
  } catch (error: any) {
    console.error("❌ Error adding columns:", error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

addStripeIdentityColumns();

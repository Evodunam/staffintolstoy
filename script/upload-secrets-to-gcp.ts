/**
 * Script to upload all environment variables to Google Cloud Secrets Manager
 * 
 * Usage:
 *   tsx script/upload-secrets-to-gcp.ts
 * 
 * Prerequisites:
 *   1. Enable Secret Manager API in your GCP project
 *   2. Set GOOGLE_CLOUD_PROJECT_ID environment variable (or it will use default)
 *   3. Authenticate with gcloud: gcloud auth application-default login
 *   4. Have a .env.production file with all your secrets
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

// Load production environment variables
const envFile = resolve(process.cwd(), ".env.production");
if (!existsSync(envFile)) {
  console.error("❌ .env.production file not found!");
  console.error("   Please create .env.production with all your secrets first.");
  process.exit(1);
}

config({ path: envFile });

const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 
                  process.env.GCP_PROJECT_ID || 
                  process.env.GOOGLE_CLOUD_PROJECT ||
                  "tolstoy-staffing-23032";

// Initialize client with explicit project ID
// This will use Application Default Credentials (ADC)
// Make sure you've run: gcloud auth application-default login
let client: SecretManagerServiceClient;
try {
  client = new SecretManagerServiceClient({
    projectId: projectId,
  });
  console.log(`✅ Initialized Secret Manager client for project: ${projectId}`);
} catch (error: any) {
  console.error("❌ Failed to initialize Secret Manager client:", error.message);
  console.error("\n💡 Make sure you've run:");
  console.error("   gcloud auth application-default login");
  console.error("\n   And that the Secret Manager API is enabled:");
  console.error(`   gcloud services enable secretmanager.googleapis.com --project=${projectId}`);
  process.exit(1);
}

// List of all secrets to upload
const secretsToUpload = [
  // Database
  "DATABASE_URL",
  
  // Session
  "SESSION_SECRET",
  
  // IDrive E2 Storage
  "IDRIVE_E2_ENDPOINT",
  "IDRIVE_E2_REGION",
  "IDRIVE_E2_ACCESS_KEY_ID",
  "IDRIVE_E2_SECRET_ACCESS_KEY",
  
  // Google OAuth
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_API_KEY",
  
  // Email (Resend)
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  
  // Stripe
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_TEST_SECRET_KEY",
  "STRIPE_TEST_PUBLISHABLE_KEY",
  
  // Firebase
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY_ID",
  "FIREBASE_CLIENT_ID",
  "FIREBASE_CLIENT_CERT_URL",
  "FIREBASE_API_KEY",
  
  // Unit Finance
  "UNIT_API_TOKEN",
  "UNIT_API_URL",
  
  // Modern Treasury
  "MODERN_TREASURY_API_KEY",
  "MODERN_TREASURY_ORG_ID",
  "MODERN_TREASURY_SANDBOX_API_KEY",
  "MODERN_TREASURY_SANDBOX_ORG_ID",
  "MT_PLATFORM_INTERNAL_ACCOUNT_ID",
  
  // Apple
  "APPLE_BUNDLE_ID",
  "APPLE_APNS_KEY_ID",
  "APPLE_TEAM_ID",
  "APPLE_APNS_PRIVATE_KEY",
  
  // Other APIs
  "GITHUB_ACCESS_TOKEN",
  "GOOGLE_CALENDAR_ACCESS_TOKEN",
  "OUTLOOK_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  
  // App Configuration
  "BASE_URL",
  "APP_URL",
  "PORT",
  
  // Optional
  "PUBLIC_OBJECT_SEARCH_PATHS",
];

async function createOrUpdateSecret(secretName: string, secretValue: string): Promise<void> {
  const parent = `projects/${projectId}`;
  const secretPath = `${parent}/secrets/${secretName}`;

  try {
    // Check if secret exists
    try {
      await client.getSecret({ name: secretPath });
      console.log(`   Secret "${secretName}" already exists, updating...`);
    } catch (error: any) {
      if (error.code === 5 || error.code === 'NOT_FOUND') {
        // Secret doesn't exist, create it
        console.log(`   Creating new secret "${secretName}"...`);
        await client.createSecret({
          parent,
          secretId: secretName,
          secret: {
            replication: {
              automatic: {},
            },
          },
        });
      } else {
        throw error;
      }
    }

    // Add new version with the secret value
    await client.addSecretVersion({
      parent: secretPath,
      payload: {
        data: Buffer.from(secretValue, 'utf8'),
      },
    });

    console.log(`   ✅ Successfully uploaded "${secretName}"`);
  } catch (error: any) {
    console.error(`   ❌ Failed to upload "${secretName}":`, error.message);
    throw error;
  }
}

async function main() {
  console.log(`\n🚀 Uploading secrets to Google Cloud Secret Manager`);
  console.log(`   Project ID: ${projectId}\n`);

  // Check if GOOGLE_APPLICATION_CREDENTIALS is set to an invalid path
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!existsSync(credPath)) {
      console.warn(`⚠️  Warning: GOOGLE_APPLICATION_CREDENTIALS is set to a non-existent path: ${credPath}`);
      console.warn(`   Unsetting it to use Application Default Credentials instead...\n`);
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
  }

  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const secretName of secretsToUpload) {
    const secretValue = process.env[secretName];
    
    if (!secretValue) {
      console.log(`   ⚠️  Skipping "${secretName}" (not found in .env.production)`);
      skippedCount++;
      continue;
    }

    try {
      await createOrUpdateSecret(secretName, secretValue);
      successCount++;
    } catch (error) {
      failedCount++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successfully uploaded: ${successCount}`);
  console.log(`   ⚠️  Skipped (not in .env): ${skippedCount}`);
  console.log(`   ❌ Failed: ${failedCount}`);
  
  if (failedCount > 0) {
    console.log(`\n⚠️  Some secrets failed to upload. Make sure:`);
    console.log(`   1. You've run: gcloud auth application-default login`);
    console.log(`   2. Secret Manager API is enabled for project ${projectId}`);
    console.log(`   3. You have the "Secret Manager Admin" role on the project`);
  } else {
    console.log(`\n✨ Done! Your secrets are now in Google Cloud Secret Manager.\n`);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});

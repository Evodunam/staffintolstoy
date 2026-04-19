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

// REQUIRED in production. Boot or critical features break if missing.
const REQUIRED_SECRETS = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "RESEND_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  // The fallback used by both webhook routes when the per-endpoint vars
  // (STRIPE_WEBHOOK_SECRET_IDENTITY / _PAYMENT_METHOD) aren't set.
  "STRIPE_WEBHOOK_SECRET",
  // Per-endpoint Stripe webhook signing secrets (preferred over the catch-all
  // STRIPE_WEBHOOK_SECRET because each Stripe webhook endpoint has a unique
  // signing secret -- using a single shared secret means signature checks
  // fail for events from the wrong endpoint).
  "STRIPE_WEBHOOK_SECRET_IDENTITY",
  "STRIPE_WEBHOOK_SECRET_PAYMENT_METHOD",
  // Cookie scoping -- added during the apex/app session-cookie unification.
  // If unset, the session falls back to the hardcoded default in
  // server/auth/session.ts but be explicit anyway.
  "SESSION_COOKIE_DOMAIN",
];

// OPTIONAL but recommended. Specific features 500 if missing; rest of app fine.
const OPTIONAL_SECRETS = [
  // IDrive E2 Storage (file uploads)
  "IDRIVE_E2_ENDPOINT",
  "IDRIVE_E2_REGION",
  "IDRIVE_E2_ACCESS_KEY_ID",
  "IDRIVE_E2_SECRET_ACCESS_KEY",
  // Google OAuth + Maps + Translate
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_API_KEY",
  "GOOGLE_PLACES_SERVER_API_KEY",
  "GOOGLE_TRANSLATE_KEY",
  // Email
  "RESEND_FROM_EMAIL",
  // Stripe extras
  "STRIPE_TEST_SECRET_KEY",
  "STRIPE_TEST_PUBLISHABLE_KEY",
  // Firebase (push notifications + admin SDK)
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY_ID",
  "FIREBASE_CLIENT_ID",
  "FIREBASE_CLIENT_CERT_URL",
  "FIREBASE_API_KEY",
  // Unit Finance (legacy)
  "UNIT_API_TOKEN",
  "UNIT_API_URL",
  // Mercury (banking — replaced Modern Treasury)
  "MERCURY_API_KEY",
  "MERCURY_API_URL",
  // Modern Treasury (deprecated, kept while migrating)
  "MODERN_TREASURY_API_KEY",
  "MODERN_TREASURY_ORG_ID",
  "MODERN_TREASURY_SANDBOX_API_KEY",
  "MODERN_TREASURY_SANDBOX_ORG_ID",
  "MT_PLATFORM_INTERNAL_ACCOUNT_ID",
  // Apple push
  "APPLE_BUNDLE_ID",
  "APPLE_APNS_KEY_ID",
  "APPLE_TEAM_ID",
  "APPLE_APNS_PRIVATE_KEY",
  // Other APIs
  "GITHUB_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "IPAPI_KEY",
  // Background-check vendor (added in megacommit 2fa06d6)
  "CHECKR_API_KEY",
  "CHECKR_WEBHOOK_SECRET",
  // Admin allow-list (added in admin-host work)
  "SUPER_ADMIN_EMAILS",
  "ADMIN_EMAILS",
  "ADMIN_SESSION_COOKIE_DOMAIN",
  // Cron auth
  "CRON_SECRET",
  // App configuration
  "BASE_URL",
  "APP_URL",
  "PORT",
  // Optional
  "PUBLIC_OBJECT_SEARCH_PATHS",
];

const secretsToUpload = [...REQUIRED_SECRETS, ...OPTIONAL_SECRETS];

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
  let skippedOptional = 0;
  const missingRequired: string[] = [];
  let failedCount = 0;

  for (const secretName of secretsToUpload) {
    const secretValue = process.env[secretName];
    const isRequired = REQUIRED_SECRETS.includes(secretName);

    if (!secretValue) {
      if (isRequired) {
        console.log(`   ❌ MISSING REQUIRED "${secretName}" — production will not boot/function correctly.`);
        missingRequired.push(secretName);
      } else {
        console.log(`   ⚠️  Skipping optional "${secretName}" (not in .env.production)`);
        skippedOptional++;
      }
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
  console.log(`   ✅ Uploaded:                ${successCount}`);
  console.log(`   ⚠️  Skipped (optional):      ${skippedOptional}`);
  console.log(`   ❌ Missing (REQUIRED):       ${missingRequired.length}`);
  console.log(`   ❌ Failed to upload:         ${failedCount}`);

  if (missingRequired.length > 0) {
    console.log(`\n❌ The following REQUIRED secrets are missing from .env.production:`);
    for (const s of missingRequired) console.log(`     - ${s}`);
    console.log(`\n   Production WILL be broken until these are set. Add them to .env.production`);
    console.log(`   and re-run this script.`);
    process.exit(2);
  }
  if (failedCount > 0) {
    console.log(`\n⚠️  Some secrets failed to upload. Make sure:`);
    console.log(`   1. You've run: gcloud auth application-default login`);
    console.log(`   2. Secret Manager API is enabled for project ${projectId}`);
    console.log(`   3. You have the "Secret Manager Admin" role on the project`);
    process.exit(1);
  }
  console.log(`\n✨ Done! Your secrets are now in Google Cloud Secret Manager.\n`);
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});

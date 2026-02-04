/**
 * Script to add OAuth redirect URIs to Google OAuth client
 * 
 * Usage:
 *   tsx script/add-google-oauth-redirects.ts
 * 
 * Prerequisites:
 *   1. Set GOOGLE_CLOUD_PROJECT_ID environment variable
 *   2. Authenticate with gcloud: gcloud auth application-default login
 *   3. Have GOOGLE_CLIENT_ID in your environment or .env.production
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { config } from "dotenv";
import { resolve } from "path";
import { existsSync } from "fs";

// Load production environment variables if available
const envFile = resolve(process.cwd(), ".env.production");
if (existsSync(envFile)) {
  config({ path: envFile });
}

const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 
                  process.env.GCP_PROJECT_ID || 
                  process.env.GOOGLE_CLOUD_PROJECT ||
                  "tolstoy-staffing-23032";

// Get Google Client ID from environment or secrets
async function getGoogleClientId(): Promise<string | null> {
  // First try environment variable
  if (process.env.GOOGLE_CLIENT_ID) {
    return process.env.GOOGLE_CLIENT_ID;
  }

  // Try to get from Secret Manager
  try {
    const client = new SecretManagerServiceClient({ projectId });
    const secretPath = `projects/${projectId}/secrets/GOOGLE_CLIENT_ID/versions/latest`;
    const [version] = await client.accessSecretVersion({ name: secretPath });
    return version.payload?.data?.toString() || null;
  } catch (error) {
    console.warn("Could not fetch GOOGLE_CLIENT_ID from Secret Manager");
    return null;
  }
}

async function main() {
  console.log(`\n🔧 Adding OAuth redirect URIs to Google OAuth client`);
  console.log(`   Project ID: ${projectId}\n`);

  const clientId = await getGoogleClientId();
  if (!clientId) {
    console.error("❌ GOOGLE_CLIENT_ID not found!");
    console.error("   Please set GOOGLE_CLIENT_ID in your environment or .env.production file.");
    process.exit(1);
  }

  console.log(`   Client ID: ${clientId.substring(0, 30)}...\n`);

  // Extract the OAuth client ID number from the full client ID
  // Format: xxxxxx-xxxxx.apps.googleusercontent.com
  const clientIdMatch = clientId.match(/^([^-]+)/);
  if (!clientIdMatch) {
    console.error("❌ Invalid GOOGLE_CLIENT_ID format!");
    process.exit(1);
  }

  const oauthClientId = clientIdMatch[1];

  // OAuth Callback URIs (these are the actual callback endpoints)
  // Note: Check your BASE_URL/APP_URL env vars to determine which production domain to use
  const callbackUris = [
    "http://localhost:2000/api/auth/google/callback",
    "https://app.tolstoystaffing.com/api/auth/google/callback", // If using app subdomain
    // "https://tolstoystaffing.com/api/auth/google/callback", // If using main domain (uncomment if needed)
  ];
  
  // Note: The final destination URLs (like /company-dashboard, /worker-onboarding, etc.)
  // are handled by the application code after OAuth authentication completes.
  // Only the callback URLs above need to be registered in Google Console.

  console.log("📋 OAuth Callback URIs to add:");
  console.log("   (These are the only URIs that need to be in Google Console)");
  callbackUris.forEach(uri => console.log(`   - ${uri}`));
  console.log();
  console.log("ℹ️  Note: The application will automatically redirect users to:");
  console.log("   - /company-dashboard (for companies)");
  console.log("   - /dashboard/today (for workers)");
  console.log("   - /company-onboarding (for new companies)");
  console.log("   - /worker-onboarding (for new workers)");
  console.log("   These destination URLs don't need to be in Google Console.");
  console.log();

  // Use gcloud CLI to update OAuth client
  // Note: This requires the Identity Platform API or using the Google Cloud Console
  console.log("⚠️  Note: Google OAuth redirect URIs must be added manually through:");
  console.log("   1. Google Cloud Console: https://console.cloud.google.com/apis/credentials");
  console.log("   2. Or using the gcloud CLI commands below:\n");

  console.log("📝 Run these commands to add the redirect URIs:\n");
  console.log(`gcloud auth application-default login`);
  console.log(`gcloud config set project ${projectId}`);
  console.log();
  console.log("# Get the current OAuth client configuration");
  console.log(`gcloud alpha iap oauth-clients describe ${oauthClientId} --project=${projectId} || echo "Client not found via IAP API"`);
  console.log();
  console.log("# Alternative: Use the Google Cloud Console UI:");
  console.log(`# 1. Go to: https://console.cloud.google.com/apis/credentials?project=${projectId}`);
  console.log(`# 2. Find your OAuth 2.0 Client ID: ${clientId.substring(0, 30)}...`);
  console.log(`# 3. Click on it to edit`);
  console.log(`# 4. Under "Authorized redirect URIs", click "ADD URI"`);
  console.log(`# 5. Add each of these callback URIs:`);
  callbackUris.forEach(uri => console.log(`#    - ${uri}`));
  console.log(`# 6. Click "SAVE"`);
  console.log();

  // Provide clear instructions for manual setup
  console.log("💡 Manual setup required:");
  console.log("   Google OAuth redirect URIs must be added through the Google Cloud Console UI.\n");
  
  console.log("🌐 Direct link to OAuth credentials:");
  console.log(`   https://console.cloud.google.com/apis/credentials?project=${projectId}\n`);
  
  console.log("📋 Step-by-step instructions:");
  console.log("   1. Open the link above in your browser");
  console.log("   2. Find your OAuth 2.0 Client ID in the list");
  console.log(`      (Look for: ${clientId.substring(0, 40)}...)`);
  console.log("   3. Click on the OAuth 2.0 Client ID name to edit it");
  console.log("   4. Scroll down to the 'Authorized redirect URIs' section");
    console.log("   5. Click 'ADD URI' button");
    console.log("   6. Add each of these OAuth callback URIs one by one:");
    callbackUris.forEach((uri, index) => {
      console.log(`      ${index + 1}. ${uri}`);
    });
    console.log("   7. Click 'SAVE' at the bottom of the page\n");
  
  console.log("✅ After adding the callback URIs:");
  console.log("   - Local development: http://localhost:2000/api/auth/google/callback");
  console.log("   - Production: https://app.tolstoystaffing.com/api/auth/google/callback");
  console.log("   Both should work for Google OAuth login.\n");
  
  console.log("📝 How the redirect flow works:");
  console.log("   1. User clicks 'Sign in with Google'");
  console.log("   2. Google redirects to: /api/auth/google/callback");
  console.log("   3. Application authenticates the user");
  console.log("   4. Application redirects to:");
  console.log("      - Existing company → /company-dashboard");
  console.log("      - Existing worker → /dashboard/today");
  console.log("      - New company → /company-onboarding?googleAuth=true");
  console.log("      - New worker → /worker-onboarding?googleAuth=true");
  console.log();
  
  console.log("🔍 To verify the callback URIs were added:");
  console.log("   1. Go back to the OAuth credentials page");
  console.log("   2. Click on your OAuth 2.0 Client ID");
  console.log("   3. Check that both callback URIs are listed under 'Authorized redirect URIs'\n");
  
  console.log("⚠️  IMPORTANT: Clean up Google Console - Remove these incorrect URIs:");
  console.log("   ❌ http://localhost:2000/company-dashboard");
  console.log("   ❌ http://localhost:2000/dashboard/today");
  console.log("   ❌ http://localhost:2000/worker-onboarding");
  console.log("   ❌ https://tolstoystaffing.com (root URL)");
  console.log("   ❌ http://localhost:3000/ (wrong port)");
  console.log("   ❌ https://app.tolstoystaffing.com/company-onboarding");
  console.log("   ❌ https://app.tolstoystaffing.com/company-dashboard");
  console.log("   ❌ https://app.tolstoystaffing.com/worker-onboarding");
  console.log();
  console.log("   ✅ KEEP ONLY these callback URLs:");
  callbackUris.forEach(uri => console.log(`      ${uri}`));
  console.log();
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});

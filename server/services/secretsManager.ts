import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

/**
 * Google Cloud Secrets Manager service
 * Fetches secrets from GCP Secret Manager in production
 */
class SecretsManagerService {
  private client: SecretManagerServiceClient | null = null;
  private projectId: string;
  private cache: Map<string, { value: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

  constructor() {
    // Get project ID from environment or default
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || 
                     process.env.GCP_PROJECT_ID || 
                     process.env.GOOGLE_CLOUD_PROJECT ||
                     "tolstoy-staffing-23032"; // Default to your Firebase project ID

    // Only initialize client in production
    if (process.env.NODE_ENV === "production") {
      try {
        const inlineServiceAccount = process.env.GCP_SERVICE_ACCOUNT_JSON?.trim();
        const base64ServiceAccount = process.env.GCP_SERVICE_ACCOUNT_B64?.trim();
        if (inlineServiceAccount) {
          const credentials = JSON.parse(inlineServiceAccount);
          this.client = new SecretManagerServiceClient({ credentials });
          console.log("[Secrets Manager] Using inline GCP service account credentials (GCP_SERVICE_ACCOUNT_JSON)");
        } else if (base64ServiceAccount) {
          const decoded = Buffer.from(base64ServiceAccount, "base64").toString("utf8");
          const credentials = JSON.parse(decoded);
          this.client = new SecretManagerServiceClient({ credentials });
          console.log("[Secrets Manager] Using base64 GCP service account credentials (GCP_SERVICE_ACCOUNT_B64)");
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
          // Explicit ADC path provided by environment.
          this.client = new SecretManagerServiceClient();
          console.log("[Secrets Manager] Using GOOGLE_APPLICATION_CREDENTIALS for auth");
        } else {
          // Do not initialize an ADC-based client implicitly on platforms without ADC.
          // We will use environment variables as the source of truth in this mode.
          this.client = null;
          console.warn("[Secrets Manager] No explicit GCP credentials provided; using environment variable fallback");
        }
        console.log(`[Secrets Manager] Initialized for project: ${this.projectId}`);
      } catch (error) {
        console.error("[Secrets Manager] Failed to initialize client:", error);
        console.warn("[Secrets Manager] Falling back to environment variables");
      }
    }
  }

  /**
   * Get a secret value from Google Cloud Secrets Manager
   * Falls back to environment variable if not in production or if GCP fails
   */
  async getSecret(secretName: string, envVarName?: string): Promise<string | undefined> {
    const fallbackKey = envVarName || secretName;

    // In development, always use environment variables
    if (process.env.NODE_ENV !== "production") {
      return process.env[fallbackKey];
    }

    // In production, prefer explicit environment variables first.
    // This avoids unnecessary Secret Manager calls when values are already present.
    const envValue = process.env[fallbackKey];
    if (envValue && envValue.length > 0) {
      return envValue;
    }

    // Check cache first
    const cached = this.cache.get(secretName);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.value;
    }

    // Try to get from GCP Secret Manager
    if (this.client) {
      try {
        const name = `projects/${this.projectId}/secrets/${secretName}/versions/latest`;
        const [version] = await this.client.accessSecretVersion({ name });
        
        if (version.payload?.data) {
          const secretValue = version.payload.data.toString();
          
          // Cache the value
          this.cache.set(secretName, {
            value: secretValue,
            timestamp: Date.now(),
          });
          
          console.log(`[Secrets Manager] ✅ Loaded secret: ${secretName}`);
          return secretValue;
        }
      } catch (error: any) {
        // If secret doesn't exist in GCP, fall back to env var
        if (error.code === 5 || error.code === 'NOT_FOUND') {
          console.warn(`[Secrets Manager] ⚠️  Secret "${secretName}" not found in GCP, using environment variable`);
        } else if (
          String(error?.message || "").includes("Could not load the default credentials") ||
          String(error?.message || "").includes("NO_ADC_FOUND")
        ) {
          console.warn("[Secrets Manager] ADC not available; disabling GCP client and using environment variables");
          this.client = null;
        } else {
          console.error(`[Secrets Manager] ❌ Error fetching secret "${secretName}":`, error.message);
        }
      }
    }

    // Fallback to environment variable
    return process.env[fallbackKey];
  }

  /**
   * Load all secrets from GCP and set them as environment variables
   * This should be called at server startup in production
   */
  async loadAllSecrets(): Promise<void> {
    if (process.env.NODE_ENV !== "production" || !this.client) {
      console.log("[Secrets Manager] Skipping (not in production or client not initialized)");
      return;
    }

    console.log("[Secrets Manager] Loading secrets from Google Cloud Secret Manager...");

    // List of all secrets that should be loaded
    const secretsToLoad = [
      // Database
      { secretName: "DATABASE_URL", envVar: "DATABASE_URL" },
      
      // Session
      { secretName: "SESSION_SECRET", envVar: "SESSION_SECRET" },
      
      // IDrive E2 Storage
      { secretName: "IDRIVE_E2_ENDPOINT", envVar: "IDRIVE_E2_ENDPOINT" },
      { secretName: "IDRIVE_E2_REGION", envVar: "IDRIVE_E2_REGION" },
      { secretName: "IDRIVE_E2_ACCESS_KEY_ID", envVar: "IDRIVE_E2_ACCESS_KEY_ID" },
      { secretName: "IDRIVE_E2_SECRET_ACCESS_KEY", envVar: "IDRIVE_E2_SECRET_ACCESS_KEY" },
      
      // Google OAuth
      { secretName: "GOOGLE_CLIENT_ID", envVar: "GOOGLE_CLIENT_ID" },
      { secretName: "GOOGLE_CLIENT_SECRET", envVar: "GOOGLE_CLIENT_SECRET" },
      { secretName: "GOOGLE_API_KEY", envVar: "GOOGLE_API_KEY" },
      
      // Email (Resend)
      { secretName: "RESEND_API_KEY", envVar: "RESEND_API_KEY" },
      { secretName: "RESEND_FROM_EMAIL", envVar: "RESEND_FROM_EMAIL" },
      
      // Stripe
      { secretName: "STRIPE_SECRET_KEY", envVar: "STRIPE_SECRET_KEY" },
      { secretName: "STRIPE_PUBLISHABLE_KEY", envVar: "STRIPE_PUBLISHABLE_KEY" },
      { secretName: "STRIPE_TEST_SECRET_KEY", envVar: "STRIPE_TEST_SECRET_KEY" },
      { secretName: "STRIPE_TEST_PUBLISHABLE_KEY", envVar: "STRIPE_TEST_PUBLISHABLE_KEY" },
      { secretName: "STRIPE_WEBHOOK_SECRET", envVar: "STRIPE_WEBHOOK_SECRET" },
      { secretName: "STRIPE_WEBHOOK_SECRET_IDENTITY", envVar: "STRIPE_WEBHOOK_SECRET_IDENTITY" },
      { secretName: "STRIPE_WEBHOOK_SECRET_PAYMENT_METHOD", envVar: "STRIPE_WEBHOOK_SECRET_PAYMENT_METHOD" },
      
      // Firebase
      { secretName: "FIREBASE_PRIVATE_KEY", envVar: "FIREBASE_PRIVATE_KEY" },
      { secretName: "FIREBASE_PROJECT_ID", envVar: "FIREBASE_PROJECT_ID" },
      { secretName: "FIREBASE_CLIENT_EMAIL", envVar: "FIREBASE_CLIENT_EMAIL" },
      { secretName: "FIREBASE_PRIVATE_KEY_ID", envVar: "FIREBASE_PRIVATE_KEY_ID" },
      { secretName: "FIREBASE_CLIENT_ID", envVar: "FIREBASE_CLIENT_ID" },
      { secretName: "FIREBASE_CLIENT_CERT_URL", envVar: "FIREBASE_CLIENT_CERT_URL" },
      { secretName: "FIREBASE_API_KEY", envVar: "FIREBASE_API_KEY" },
      
      // Mercury Bank
      { secretName: "MERCURY_PRODUCTION_API_TOKEN", envVar: "MERCURY_PRODUCTION_API_TOKEN" },
      { secretName: "Mercury_Production", envVar: "Mercury_Production" },
      { secretName: "MERCURY_ACCOUNT_ID", envVar: "MERCURY_ACCOUNT_ID" },

      // Modern Treasury
      { secretName: "MODERN_TREASURY_API_KEY", envVar: "MODERN_TREASURY_API_KEY" },
      { secretName: "MODERN_TREASURY_ORG_ID", envVar: "MODERN_TREASURY_ORG_ID" },
      { secretName: "MODERN_TREASURY_SANDBOX_API_KEY", envVar: "MODERN_TREASURY_SANDBOX_API_KEY" },
      { secretName: "MODERN_TREASURY_SANDBOX_ORG_ID", envVar: "MODERN_TREASURY_SANDBOX_ORG_ID" },
      { secretName: "MT_PLATFORM_INTERNAL_ACCOUNT_ID", envVar: "MT_PLATFORM_INTERNAL_ACCOUNT_ID" },
      
      // Apple
      { secretName: "APPLE_BUNDLE_ID", envVar: "APPLE_BUNDLE_ID" },
      { secretName: "APPLE_APNS_KEY_ID", envVar: "APPLE_APNS_KEY_ID" },
      { secretName: "APPLE_TEAM_ID", envVar: "APPLE_TEAM_ID" },
      { secretName: "APPLE_APNS_PRIVATE_KEY", envVar: "APPLE_APNS_PRIVATE_KEY" },
      
      // Other APIs
      { secretName: "OPENAI_API_KEY", envVar: "OPENAI_API_KEY" },
      { secretName: "GOOGLE_PLACES_SERVER_KEY", envVar: "GOOGLE_PLACES_SERVER_KEY" },
      { secretName: "GOOGLE_TRANSLATE_API_KEY", envVar: "GOOGLE_TRANSLATE_API_KEY" },
      { secretName: "IPAPI_API_KEY", envVar: "IPAPI_API_KEY" },

      // Auth & Admin
      { secretName: "CRON_SECRET", envVar: "CRON_SECRET" },
      { secretName: "ADMIN_EMAILS", envVar: "ADMIN_EMAILS" },

      // App Configuration
      { secretName: "BASE_URL", envVar: "BASE_URL" },
      { secretName: "APP_URL", envVar: "APP_URL" },
      { secretName: "PORT", envVar: "PORT" },
      
      // Optional
      { secretName: "PUBLIC_OBJECT_SEARCH_PATHS", envVar: "PUBLIC_OBJECT_SEARCH_PATHS" },

      // REMOVED: per-user OAuth tokens belong in DB, not Secret Manager:
      //   GITHUB_ACCESS_TOKEN, GOOGLE_CALENDAR_ACCESS_TOKEN, OUTLOOK_ACCESS_TOKEN
      // REMOVED: deprecated:
      //   UNIT_API_TOKEN (migrated to Mercury + Stripe, Jan 2026)
      //   VITE_GOOGLE_API_KEY (build-time client var, set via Vite env at build)
    ];

    let loadedCount = 0;
    let failedCount = 0;

    // Load secrets in parallel
    const loadPromises = secretsToLoad.map(async ({ secretName, envVar }) => {
      try {
        const value = await this.getSecret(secretName, envVar);
        if (value) {
          process.env[envVar] = value;
          loadedCount++;
          return { secretName, success: true };
        } else {
          failedCount++;
          return { secretName, success: false, reason: "No value found" };
        }
      } catch (error: any) {
        failedCount++;
        console.error(`[Secrets Manager] Failed to load ${secretName}:`, error.message);
        return { secretName, success: false, reason: error.message };
      }
    });

    await Promise.all(loadPromises);

    console.log(`[Secrets Manager] ✅ Loaded ${loadedCount} secrets, ${failedCount} failed/not found`);
  }

  /**
   * Clear the cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const secretsManager = new SecretsManagerService();

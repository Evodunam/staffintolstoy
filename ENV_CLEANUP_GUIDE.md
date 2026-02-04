# Environment Variables Cleanup Guide

## ✅ **KEEP THESE** (Required for Application)

### Core Application
- `SESSION_SECRET` - Required for session management
- `DATABASE_URL` - PostgreSQL connection string
- `BASE_URL` or `APP_URL` - Application base URL
- `PORT` - Server port (5000 for dev, or as configured)

### Object Storage (Google Cloud Storage)
- `PUBLIC_OBJECT_SEARCH_PATHS` - Public files path
- `PRIVATE_OBJECT_DIR` - Private files directory
- `GCS_PROJECT_ID` - Google Cloud Project ID (if using GCS)
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to GCS service account JSON (if using GCS)

### Google Services
- `GOOGLE_CLIENT_ID` - OAuth client ID
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `GOOGLE_API_KEY` - Google Maps/Places API key (server: geocoding, map thumbnails, fleet routing)
- `VITE_GOOGLE_API_KEY` - Client-side Google API key (same as above, for maps/places in the app)

**API key rotation:** Map images in emails use the proxy `/api/map-thumbnail?jobId=...`; the key is never embedded in email HTML. To rotate: update both `GOOGLE_API_KEY` and `VITE_GOOGLE_API_KEY` in env and redeploy. Existing stored `map_thumbnail_url` values are still served via the proxy; only new thumbnail generation uses the new key.

### Firebase
- `FIREBASE_API_KEY` - Firebase API key
- `FIREBASE_VAPID_PRIVATE_KEY` - Firebase VAPID key for push notifications

### Email (Resend)
- `RESEND_API_KEY` - Required for email functionality

### Stripe
- `STRIPE_PUBLISHABLE_KEY` - Stripe publishable key (live)
- `STRIPE_SECRET_KEY` - Stripe secret key (live)
- `STRIPE_TEST_PUBLISHABLE_KEY` - Stripe test publishable key
- `STRIPE_TEST_SECRET_KEY` - Stripe test secret key

### OpenAI
- `OPENAI_API_KEY` - For AI features (job estimation, etc.)

### Apple Push Notifications
- `APPLE_APNS_KEY_ID` - Apple APNS key ID
- `APPLE_APNS_PRIVATE_KEY` - Apple APNS private key
- `APPLE_BUNDLE_ID` - Apple bundle ID
- `APPLE_TEAM_ID` - Apple team ID

### Mercury Bank (Current Payment Provider)
- `Mercury_Sandbox` - Mercury sandbox API token (for development)
- `Mercury_Production` - Mercury production API token (for production, stored in GCP Secrets Manager)

---

## ❌ **REMOVE THESE** (Deprecated/Not Needed)

### Unit Payment Platform (Migrated to Mercury)
- `UNIT_API_TOKEN` - No longer needed, migrated to Mercury

### Modern Treasury (Migrated to Mercury)
- `MODERN_TREASURY_API_KEY` - No longer needed
- `MODERN_TREASURY_ORG_ID` - No longer needed
- `MODERN_TREASURY_PUBLISHABLE_KEY` - No longer needed
- `MODERN_TREASURY_SANDBOX_API_KEY` - No longer needed
- `MODERN_TREASURY_SANDBOX_ORG_ID` - No longer needed
- `MODERN_TREASURY_SANDBOX_PUBLISHABLE_KEY` - No longer needed
- `MT_PLATFORM_INTERNAL_ACCOUNT_ID` - No longer needed

### Replit Object Storage (If using GCS now)
- `DEFAULT_OBJECT_STORAGE_BUCKET_ID` - Only if you've migrated to GCS

---

## 📝 **Recommended .env.development Structure**

```env
# ============================================
# CORE APPLICATION
# ============================================
PORT=5000
DATABASE_URL=postgresql://postgres:password@localhost:5432/tolstoy_staffing_dev?sslmode=disable
BASE_URL=http://localhost:5000
SESSION_SECRET=HQsATQMPmwYvgKynek1tew/ZmefyTXpWQ4YQXlqQADzgM1WQjZoSJIlI3vJNHCKGRp3tt0rVCtXonQN4jaARZw==

# ============================================
# OBJECT STORAGE (Google Cloud Storage)
# ============================================
PUBLIC_OBJECT_SEARCH_PATHS=/your-bucket-name/public
PRIVATE_OBJECT_DIR=/your-bucket-name/.private
GCS_PROJECT_ID=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# ============================================
# GOOGLE SERVICES
# ============================================
GOOGLE_CLIENT_ID=<your-google-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_API_KEY=<your-google-api-key>
VITE_GOOGLE_API_KEY=<your-google-api-key>

# ============================================
# FIREBASE
# ============================================
FIREBASE_API_KEY=<your-firebase-api-key>
FIREBASE_VAPID_PRIVATE_KEY=<your-firebase-vapid-key>

# ============================================
# EMAIL (RESEND)
# ============================================
RESEND_API_KEY=<your-resend-api-key>

# ============================================
# STRIPE
# ============================================
STRIPE_PUBLISHABLE_KEY=<your-stripe-publishable-key>
STRIPE_SECRET_KEY=<your-stripe-secret-key>
STRIPE_TEST_PUBLISHABLE_KEY=<your-stripe-test-publishable-key>
STRIPE_TEST_SECRET_KEY=<your-stripe-test-secret-key>

# ============================================
# OPENAI
# ============================================
OPENAI_API_KEY=<your-openai-api-key>

# ============================================
# APPLE PUSH NOTIFICATIONS
# ============================================
APPLE_APNS_KEY_ID=<your-apple-apns-key-id>
APPLE_APNS_PRIVATE_KEY=<your-apple-apns-private-key>
APPLE_BUNDLE_ID=<your-bundle-id>
APPLE_TEAM_ID=<your-team-id>

# ============================================
# MERCURY BANK (Current Payment Provider)
# ============================================
# Add your Mercury sandbox token here (can include "secret-token:" prefix or just the token)
Mercury_Sandbox=<your-mercury-sandbox-token>
# Note: Mercury_Production is stored in GCP Secrets Manager for production
```

---

## 🧹 **Cleanup Steps**

1. **Remove deprecated keys** from your `.env.development`:
   - All `UNIT_*` keys
   - All `MODERN_TREASURY_*` keys
   - `MT_PLATFORM_INTERNAL_ACCOUNT_ID`

2. **Add Mercury tokens** (if not already present):
   - Get your Mercury sandbox token from Mercury dashboard
   - Add it as `MERCURY_SANDBOX=secret-token:your-token`

3. **Update object storage paths** (if migrated to GCS):
   - Replace Replit bucket paths with your GCS bucket paths
   - Add `GCS_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS`

4. **Verify all required keys are present** using the list above

---

## ⚠️ **Note**

The codebase may still have references to Unit and Modern Treasury in:
- `server/services/unit.ts` (can be removed if not used)
- `server/services/secretsManager.ts` (cleanup needed)
- `server/routes.ts` (some legacy endpoints)

These can be cleaned up in a future refactor, but removing the environment variables is safe as long as you're using Mercury for all payments.

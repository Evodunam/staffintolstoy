# Required Environment Variable Updates

Based on your current `.env` file, here are the specific values you need to update:

## 🔴 CRITICAL: Must Update These

### 1. Object Storage Bucket Paths

**Current (Replit):**
```env
DEFAULT_OBJECT_STORAGE_BUCKET_ID="replit-objstore-639d7dc9-d6b1-4269-b09e-b1f4c8f8f1cb"
PUBLIC_OBJECT_SEARCH_PATHS="/replit-objstore-639d7dc9-d6b1-4269-b09e-b1f4c8f8f1cb/public"
PRIVATE_OBJECT_DIR="/replit-objstore-639d7dc9-d6b1-4269-b09e-b1f4c8f8f1cb/.private"
```

**Update to (replace `your-bucket-name` with your actual GCS bucket name):**
```env
# This can be removed - it's not used in the code
# DEFAULT_OBJECT_STORAGE_BUCKET_ID="your-bucket-name"

PUBLIC_OBJECT_SEARCH_PATHS="/your-bucket-name/public"
PRIVATE_OBJECT_DIR="/your-bucket-name/.private"
```

### 2. Add Google Cloud Storage Configuration

Add these new environment variables:

```env
# Your Google Cloud Project ID
GCS_PROJECT_ID="your-google-cloud-project-id"

# Option 1: Path to service account JSON file
GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"

# OR Option 2: Service account JSON as a string (alternative)
# GCS_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","private_key":"..."}'
```

### 3. Add Base URL

Add your application's base URL:

```env
BASE_URL="https://your-domain.com"
# OR
APP_URL="https://your-domain.com"
```

## ✅ Keep These As-Is

All other environment variables can remain the same:
- `SESSION_SECRET` ✓
- All `GOOGLE_*` keys (except calendar token if needed) ✓
- All `FIREBASE_*` keys ✓
- All `VITE_FIREBASE_*` keys ✓
- `RESEND_API_KEY` ✓ (Required for email functionality)
- `RESEND_FROM_EMAIL` (Optional - defaults to 'Tolstoy Staffing <notifications@tolstoystaffing.com>')
- `UNIT_API_TOKEN` ✓
- All `MODERN_TREASURY_*` keys ✓
- All `STRIPE_*` keys ✓
- All `APPLE_*` keys ✓
- `OPENAI_API_KEY` ✓

## 📋 Quick Setup Steps

1. **Create a Google Cloud Storage bucket:**
   - Name it something like `tolstoy-staffing-files`
   - Note the bucket name for the paths above

2. **Create a service account:**
   - Go to Google Cloud Console > IAM & Admin > Service Accounts
   - Create a new service account with "Storage Admin" role
   - Download the JSON key file

3. **Update your `.env` file:**
   - Replace the three Replit bucket paths with your new bucket name
   - Add `GCS_PROJECT_ID` with your Google Cloud project ID
   - Add `GOOGLE_APPLICATION_CREDENTIALS` pointing to your service account JSON file
   - Add `BASE_URL` or `APP_URL` with your domain

4. **Update Google OAuth redirect URIs:**
   - In Google Cloud Console, update your OAuth client
   - Add your new domain to authorized redirect URIs

## Example Updated Values

```env
# Object Storage (example with bucket name "tolstoy-staffing-files")
PUBLIC_OBJECT_SEARCH_PATHS="/tolstoy-staffing-files/public"
PRIVATE_OBJECT_DIR="/tolstoy-staffing-files/.private"

# Google Cloud Storage
GCS_PROJECT_ID="tolstoy-staffing-23032"
GOOGLE_APPLICATION_CREDENTIALS="./service-account-key.json"

# Base URL
BASE_URL="https://tolstoystaffing.com"
```

See `MIGRATION_GUIDE.md` for more detailed instructions.

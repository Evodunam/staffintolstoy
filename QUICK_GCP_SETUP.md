# Quick Google Cloud Secrets Manager Setup

## Project Information

- **Project Name**: Tolstoy Staffing
- **Project ID**: `tolstoy-staffing-23032`
- **Organization**: tolstoystaffing.com (582677657836)

## Step 1: Install Google Cloud SDK

### Option A: Download Installer

1. Go to: <https://cloud.google.com/sdk/docs/install>
2. Download the Windows installer
3. Run the installer
4. Restart your terminal

### Option B: Use winget (if available)

```powershell
winget install Google.CloudSDK
```

## Step 2: Run These Commands

```powershell
# 1. Set your project
gcloud config set project tolstoy-staffing-23032

# 2. Authenticate
gcloud auth application-default login

# 3. Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com --project=tolstoy-staffing-23032

# 4. Verify project is set
gcloud config get-value project
```

## Step 3: Upload Your Secrets

```powershell
# Make sure .env.production exists with all your secrets
# Then run:
npm run secrets:upload
```

## Alternative: Use Google Cloud Console (No CLI Required)

If you don't want to install the CLI, you can manually create secrets:

1. Go to: <https://console.cloud.google.com/security/secret-manager?project=tolstoy-staffing-23032>
2. Click **"CREATE SECRET"**
3. For each secret:
   - **Name**: Use the exact environment variable name (e.g., `DATABASE_URL`)
   - **Secret value**: Paste the value from your `.env.production`
   - Click **"CREATE SECRET"**

### Secrets to Create

- DATABASE_URL
- SESSION_SECRET
- IDRIVE_E2_ENDPOINT
- IDRIVE_E2_REGION
- IDRIVE_E2_ACCESS_KEY_ID
- IDRIVE_E2_SECRET_ACCESS_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_API_KEY
- RESEND_API_KEY
- RESEND_FROM_EMAIL
- STRIPE_SECRET_KEY
- STRIPE_PUBLISHABLE_KEY
- FIREBASE_PRIVATE_KEY
- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- UNIT_API_TOKEN
- MODERN_TREASURY_API_KEY
- MODERN_TREASURY_ORG_ID
- APPLE_APNS_KEY_ID
- APPLE_TEAM_ID
- APPLE_APNS_PRIVATE_KEY
- (And any other secrets from your .env.production)

## Verify Setup

Once secrets are uploaded, your production server will automatically:

- ✅ Load secrets from Google Cloud Secret Manager
- ✅ Fall back to environment variables if GCP fails
- ✅ Cache secrets for 5 minutes

# Google Cloud Secrets Manager Setup

This guide explains how to migrate all environment variables to Google Cloud Secrets Manager for production.

## Prerequisites

1. **Google Cloud Project** with Secret Manager API enabled
2. **Authentication** set up for GCP
3. **Project ID** configured

## Step 1: Enable Secret Manager API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Navigate to **APIs & Services** > **Library**
4. Search for "Secret Manager API"
5. Click **Enable**

## Step 2: Authenticate with Google Cloud

You need to authenticate your local machine to access GCP:

```bash
# Install Google Cloud SDK if you haven't already
# https://cloud.google.com/sdk/docs/install

# Authenticate
gcloud auth application-default login

# Set your project ID
gcloud config set project YOUR_PROJECT_ID
```

Or set the project ID as an environment variable:

```bash
export GOOGLE_CLOUD_PROJECT_ID=your-project-id
```

## Step 3: Upload Secrets to GCP

1. **Create `.env.production`** with all your production secrets (if you haven't already)

2. **Run the upload script**:

   ```bash
   npm run secrets:upload
   ```

   This will:
   - Read all secrets from `.env.production`
   - Create secrets in Google Cloud Secret Manager (if they don't exist)
   - Upload the secret values
   - Skip secrets that aren't in your `.env.production` file

3. **Verify secrets were uploaded**:

   ```bash
   gcloud secrets list
   ```

## Step 4: Configure Production Environment

In your production environment (e.g., Google Cloud Run, App Engine, Compute Engine):

1. **Set the project ID** (if not already set):

   ```bash
   export GOOGLE_CLOUD_PROJECT_ID=your-project-id
   ```

2. **Grant access** to the service account:
   - For Cloud Run/App Engine: The default service account needs "Secret Manager Secret Accessor" role
   - For Compute Engine: Grant the VM's service account the same role

3. **Set NODE_ENV to production**

   ```bash
   export NODE_ENV=production
   ```

## Step 5: How It Works

### Development

- Uses `.env.development` file (local development)
- Secrets Manager is **not** used

### Production

- Automatically loads secrets from Google Cloud Secret Manager
- Falls back to environment variables if GCP fails
- Secrets are cached for 5 minutes to reduce API calls

## Secret Names

Secrets are stored in GCP with the same names as your environment variables:

- `DATABASE_URL`
- `SESSION_SECRET`
- `IDRIVE_E2_ENDPOINT`
- `IDRIVE_E2_REGION`
- `IDRIVE_E2_ACCESS_KEY_ID`
- `IDRIVE_E2_SECRET_ACCESS_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `UNIT_API_TOKEN`
- `MODERN_TREASURY_API_KEY`
- `MODERN_TREASURY_ORG_ID`
- `APPLE_APNS_KEY_ID`
- `APPLE_TEAM_ID`
- `APPLE_APNS_PRIVATE_KEY`
- And more...

## Updating Secrets

To update a secret value:

1. **Update in GCP Console**:
   - Go to **Secret Manager** in Google Cloud Console
   - Click on the secret
   - Click **Add New Version**
   - Paste the new value
   - Click **Add Version**

2. **Or use the upload script again**:

   ```bash
   npm run secrets:upload
   ```

   This will create a new version with the updated value.

## Security Best Practices

1. **Never commit `.env.production`** to git (already in `.gitignore`)
2. **Rotate secrets regularly** (every 90 days recommended)
3. **Use different secrets for dev/prod**
4. **Grant minimal permissions** - only "Secret Manager Secret Accessor" role
5. **Enable audit logging** in GCP to track secret access
6. **Use IAM conditions** to restrict which services can access which secrets

## Troubleshooting

### "Permission denied" error

- Ensure the service account has "Secret Manager Secret Accessor" role
- Check that you're authenticated: `gcloud auth application-default login`

### "Secret not found" warning

- The secret doesn't exist in GCP yet
- Run `npm run secrets:upload` to create it
- Or the app will fall back to environment variables

### Secrets not loading in production

- Check that `NODE_ENV=production` is set
- Verify `GOOGLE_CLOUD_PROJECT_ID` is set correctly
- Check GCP logs for errors
- Ensure Secret Manager API is enabled

## Manual Secret Management

You can also manage secrets manually using `gcloud` CLI:

```bash
# Create a secret
gcloud secrets create SECRET_NAME --data-file=- <<< "secret-value"

# Add a new version
echo "new-secret-value" | gcloud secrets versions add SECRET_NAME --data-file=-

# Access a secret
gcloud secrets versions access latest --secret=SECRET_NAME
```

## Cost

Google Cloud Secret Manager pricing:

- **$0.06 per secret per month**
- **$0.03 per 10,000 secret versions accessed**

For most applications, this is very affordable (typically < $5/month).

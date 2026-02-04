# Migration Guide: Replit to Self-Hosted

This guide helps you complete the migration from Replit to your own infrastructure.

## Environment Variables Update

### Object Storage Configuration

You need to replace the Replit object storage bucket with your own Google Cloud Storage bucket.

**Current (Replit) values:**
```env
DEFAULT_OBJECT_STORAGE_BUCKET_ID="replit-objstore-639d7dc9-d6b1-4269-b09e-b1f4c8f8f1cb"
PUBLIC_OBJECT_SEARCH_PATHS="/replit-objstore-639d7dc9-d6b1-4269-b09e-b1f4c8f8f1cb/public"
PRIVATE_OBJECT_DIR="/replit-objstore-639d7dc9-d6b1-4269-b09e-b1f4c8f8f1cb/.private"
```

**New values (replace with your GCS bucket name):**
```env
# Optional: Default bucket ID (if you want to keep this for reference)
# DEFAULT_OBJECT_STORAGE_BUCKET_ID="your-gcs-bucket-name"

# Public files path: /<your-bucket-name>/public
PUBLIC_OBJECT_SEARCH_PATHS="/your-gcs-bucket-name/public"

# Private files path: /<your-bucket-name>/.private
PRIVATE_OBJECT_DIR="/your-gcs-bucket-name/.private"
```

### Google Cloud Storage Setup

1. **Create a Google Cloud Storage bucket:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/storage)
   - Create a new bucket (e.g., `tolstoy-staffing-files`)
   - Choose your preferred region and storage class

2. **Set up authentication:**
   - Create a service account with Storage Admin role
   - Download the service account JSON key
   - Set one of these environment variables:
     - `GOOGLE_APPLICATION_CREDENTIALS` - Path to the JSON key file, OR
     - `GCS_SERVICE_ACCOUNT_KEY` - The JSON key content as a string

3. **Set project ID:**
   ```env
   GCS_PROJECT_ID="your-google-cloud-project-id"
   ```

### Base URL Configuration

Replace Replit domain references with your own domain:

```env
# Your application's base URL
BASE_URL="https://your-domain.com"
# OR
APP_URL="https://your-domain.com"
```

### Optional: Calendar & GitHub Integrations

If you're using calendar or GitHub integrations, you'll need to set up OAuth tokens:

```env
# Google Calendar OAuth token (if using calendar integration)
GOOGLE_CALENDAR_ACCESS_TOKEN="your-google-calendar-oauth-token"

# Outlook OAuth token (if using Outlook calendar integration)
OUTLOOK_ACCESS_TOKEN="your-outlook-oauth-token"

# GitHub OAuth token (if using GitHub integration)
GITHUB_ACCESS_TOKEN="your-github-oauth-token"
```

## Steps to Complete Migration

1. **Create Google Cloud Storage bucket:**
   ```bash
   # Using gcloud CLI (if installed)
   gsutil mb -p your-project-id -c STANDARD -l us-central1 gs://your-bucket-name
   ```

2. **Update environment variables:**
   - Replace all Replit bucket references with your new bucket name
   - Set up Google Cloud Storage credentials
   - Update BASE_URL/APP_URL to your domain

3. **Update Google OAuth redirect URIs:**
   - Go to [Google Cloud Console > APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
   - Update your OAuth 2.0 Client ID
   - Add your new domain to authorized redirect URIs:
     - `https://your-domain.com/api/callback`
     - `https://your-domain.com/company-dashboard`
     - `https://your-domain.com/worker-dashboard`

4. **Test the migration:**
   - Start your application
   - Test file uploads
   - Test authentication
   - Verify all integrations work

## Environment Variables Summary

### Required
- `SESSION_SECRET` - Already set ✓
- `DATABASE_URL` - Your PostgreSQL connection string
- `BASE_URL` or `APP_URL` - Your application URL
- `PUBLIC_OBJECT_SEARCH_PATHS` - Update to your GCS bucket
- `PRIVATE_OBJECT_DIR` - Update to your GCS bucket
- `GOOGLE_APPLICATION_CREDENTIALS` or `GCS_SERVICE_ACCOUNT_KEY` - GCS auth
- `GCS_PROJECT_ID` - Your Google Cloud project ID

### Optional (for integrations)
- `GOOGLE_CALENDAR_ACCESS_TOKEN`
- `OUTLOOK_ACCESS_TOKEN`
- `GITHUB_ACCESS_TOKEN`

### Already Configured (keep as-is)
- All Firebase keys
- Stripe keys
- Modern Treasury keys
- Resend API key
- Other service keys

## Notes

- The `DEFAULT_OBJECT_STORAGE_BUCKET_ID` is optional and can be removed if not used elsewhere
- Make sure your GCS bucket has appropriate IAM permissions for your service account
- Consider setting up bucket lifecycle policies for cost optimization
- Test thoroughly before deploying to production

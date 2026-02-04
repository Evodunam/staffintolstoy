# Google Cloud Setup Commands

## Install Google Cloud SDK (if not already installed)

### Windows (PowerShell)

```powershell
# Download and install from: https://cloud.google.com/sdk/docs/install
# Or use winget:
winget install Google.CloudSDK

# After installation, restart your terminal and verify:
gcloud --version
```

### Alternative: Use Google Cloud Console

If you prefer not to install the CLI, you can manage secrets directly in the [Google Cloud Console](https://console.cloud.google.com/security/secret-manager)

## Set Your Project

```powershell
# Set the project to "Tolstoy Staffing" (tolstoy-staffing-23032)
gcloud config set project tolstoy-staffing-23032

# Verify the project is set
gcloud config get-value project

# List all projects to see current selection
gcloud projects list
```

## Authenticate with Google Cloud

```powershell
# Authenticate for application-default credentials (needed for Secret Manager)
gcloud auth application-default login

# Verify authentication
gcloud auth list
```

## Enable Secret Manager API

```powershell
# Enable the Secret Manager API
gcloud services enable secretmanager.googleapis.com --project=tolstoy-staffing-23032

# Verify it's enabled
gcloud services list --enabled --project=tolstoy-staffing-23032 | Select-String "secretmanager"
```

## Set Environment Variable (Optional)

```powershell
# Set the project ID as an environment variable (for the upload script)
$env:GOOGLE_CLOUD_PROJECT_ID="tolstoy-staffing-23032"

# Or set it permanently in PowerShell profile
[System.Environment]::SetEnvironmentVariable("GOOGLE_CLOUD_PROJECT_ID", "tolstoy-staffing-23032", "User")
```

## Upload Secrets to GCP

```powershell
# Make sure you have .env.production file with all your secrets
# Then run:
npm run secrets:upload
```

## Verify Secrets Were Uploaded

```powershell
# List all secrets
gcloud secrets list --project=tolstoy-staffing-23032

# View a specific secret (without revealing the value)
gcloud secrets describe DATABASE_URL --project=tolstoy-staffing-23032

# Access a secret value (for verification)
gcloud secrets versions access latest --secret=DATABASE_URL --project=tolstoy-staffing-23032
```

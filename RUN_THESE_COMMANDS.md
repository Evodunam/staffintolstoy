# Run These Commands in Your Terminal

Since you've already authenticated with `gcloud init`, run these commands:

## Step 1: Enable Secret Manager API

```powershell
gcloud services enable secretmanager.googleapis.com --project=tolstoy-staffing-23032
```

## Step 2: Authenticate for Application Default Credentials

```powershell
gcloud auth application-default login
```

This opens a browser for authentication. This is needed for your Node.js app to access secrets.

## Step 3: Navigate to Project Directory

```powershell
cd "C:\Users\cairl\Desktop\Imp stuff\Apps\tolstoy-staffing-main"
```

## Step 4: Upload Secrets

```powershell
npm run secrets:upload
```

This will:

- Read all secrets from `.env.production`
- Create them in Google Cloud Secret Manager
- Upload the values

## Or Run the Setup Script

I've created `setup-gcp-secrets.ps1` - you can run it:

```powershell
cd "C:\Users\cairl\Desktop\Imp stuff\Apps\tolstoy-staffing-main"
.\setup-gcp-secrets.ps1
```

Then run:

```powershell
npm run secrets:upload
```

## Verify Secrets Were Uploaded

```powershell
gcloud secrets list --project=tolstoy-staffing-23032
```

You should see all your secrets listed!

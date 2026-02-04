# Google OAuth & Firebase Setup Guide

## 🔑 Two Different Types of Google Credentials

Your application needs **TWO different types** of Google credentials:

### 1. **OAuth 2.0 Client** (for User Login)
- **Purpose**: Allows users to sign in with their Google account
- **Where to get it**: Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID
- **Required for**: Google sign-in button on login page

### 2. **Service Account** (for Push Notifications & File Storage)
- **Purpose**: Server-side operations (push notifications, Google Cloud Storage)
- **Where to get it**: Google Cloud Console → IAM & Admin → Service Accounts
- **Required for**: Firebase Admin SDK, Google Cloud Storage
- **Status**: ✅ You already have this file!

---

## 📋 Setup Instructions

### Step 1: Configure Firebase Service Account (Already Done!)

Your service account file has been copied to:
```
service-accounts/firebase-service-account.json
```

**Add to `.env.development`:**
```env
# Option 1: Use file path (recommended)
GOOGLE_APPLICATION_CREDENTIALS=service-accounts/firebase-service-account.json

# OR Option 2: Use environment variables (if you prefer)
FIREBASE_PROJECT_ID=tolstoy-staffing-23032
FIREBASE_PRIVATE_KEY_ID=47457002fcacefc23d76e9dc5a1e63c647db1c2c
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@tolstoy-staffing-23032.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=109910599856610341136
FIREBASE_CLIENT_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40tolstoy-staffing-23032.iam.gserviceaccount.com

# Also for Google Cloud Storage (can use same service account)
GCS_PROJECT_ID=tolstoy-staffing-23032
GCS_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"tolstoy-staffing-23032",...}'
```

**Add to `.env.production`:**
```env
# Same as above, but use production paths/values
GOOGLE_APPLICATION_CREDENTIALS=/path/to/production/service-account.json
GCS_PROJECT_ID=tolstoy-staffing-23032
```

---

### Step 2: Create OAuth 2.0 Client for User Login

**You need to create a separate OAuth 2.0 Client ID for user authentication:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select project: **tolstoy-staffing-23032**
3. Navigate to: **APIs & Services** → **Credentials**
4. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
5. If prompted, configure OAuth consent screen first:
   - User Type: **External** (unless you have Google Workspace)
   - App name: **Tolstoy Staffing**
   - User support email: Your email
   - Developer contact: Your email
   - Click **Save and Continue**
   - Scopes: Add `email`, `profile`, `openid`
   - Click **Save and Continue**
   - Test users: Add your email (for testing)
   - Click **Save and Continue**
6. Create OAuth Client:
   - Application type: **Web application**
   - Name: **Tolstoy Staffing Web Client**
   - Authorized JavaScript origins:
     - `http://localhost:2000`
     - `http://app.localhost:2000`
     - `https://your-production-domain.com`
     - `https://app.your-production-domain.com`
   - Authorized redirect URIs:
     - `http://localhost:2000/api/auth/google/callback`
     - `http://app.localhost:2000/api/auth/google/callback`
     - `https://your-production-domain.com/api/auth/google/callback`
     - `https://app.your-production-domain.com/api/auth/google/callback`
   - Click **Create**
7. Copy the **Client ID** and **Client Secret**

**Add to `.env.development`:**
```env
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
```

**Add to `.env.production`:**
```env
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
```

---

## ✅ Verification

### Test Firebase Service Account:
```bash
# The app will log "Firebase Admin initialized" on startup if configured correctly
npm run dev
```

### Test Google OAuth:
1. Go to `http://localhost:2000/login`
2. Click "Continue with Google"
3. You should be redirected to Google sign-in
4. After signing in, you should be redirected back to the app

---

## 🔒 Security Notes

1. **Never commit** service account JSON files or OAuth secrets to git
2. The `service-accounts/` directory is in `.gitignore`
3. Use environment variables in production
4. Rotate credentials if they're ever exposed

---

## 📝 Summary

| Credential Type | Purpose | File/Value | Status |
|----------------|---------|------------|--------|
| **Service Account** | Push notifications, GCS | `service-accounts/firebase-service-account.json` | ✅ Ready |
| **OAuth 2.0 Client** | User Google login | Client ID + Secret | ⚠️ Need to create |

---

## 🆘 Troubleshooting

### Firebase Admin not initializing:
- Check that `GOOGLE_APPLICATION_CREDENTIALS` points to the correct file path
- Verify the JSON file is valid
- Check file permissions

### Google OAuth not working:
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- Check redirect URIs match exactly (including http/https, ports, paths)
- Ensure OAuth consent screen is configured
- Check browser console for errors

### Google Cloud Storage not working:
- Verify `GCS_PROJECT_ID` matches your project
- Check service account has Storage Admin role
- Ensure bucket exists and service account has access

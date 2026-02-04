# Google OAuth Redirect URI Setup

## Overview

This document explains the Google OAuth redirect flow and which URIs need to be configured in Google Cloud Console.

## OAuth Callback Flow

1. **User clicks "Sign in with Google"** → Redirects to Google
2. **Google authenticates** → Redirects back to our callback URL
3. **Our callback handler** (`/api/auth/google/callback`) processes the authentication
4. **Application redirects** to the appropriate destination based on user state

## Required Google Console Configuration

### Authorized Redirect URIs (OAuth Callback URLs)

**Only these 2 callback URLs need to be in Google Console:**

1. **Development:**
   ```
   http://localhost:2000/api/auth/google/callback
   ```

2. **Production:**
   ```
   https://app.tolstoystaffing.com/api/auth/google/callback
   ```
   (Or `https://tolstoystaffing.com/api/auth/google/callback` if using main domain - check your BASE_URL env var)

### ❌ DO NOT Add These to Google Console

The following URLs are **final destinations** handled by the application code, NOT OAuth callback URLs:

- `http://localhost:2000/company-dashboard`
- `http://localhost:2000/dashboard/today`
- `http://localhost:2000/worker-onboarding`
- `https://tolstoystaffing.com/company-dashboard`
- `https://tolstoystaffing.com/worker-onboarding`
- `https://tolstoystaffing.com` (root URL)
- `http://localhost:3000/` (wrong port)

## Redirect Logic

After OAuth authentication completes, the application automatically redirects users to:

### Existing Users (Have Profile)
- **Company users** → `/company-dashboard`
- **Worker users** → `/dashboard/today`

### New Users (No Profile Yet)
- **Company onboarding** → `/company-onboarding?googleAuth=true`
- **Worker onboarding** → `/worker-onboarding?googleAuth=true`

The onboarding type is determined by:
1. The `onboardingData` parameter passed when initiating OAuth
2. The `returnTo` URL parameter
3. Defaults to worker onboarding if neither is specified

## Environment Configuration

The application uses environment variables to determine the correct base URL:

- **Development:** `BASE_URL=http://localhost:2000` or `APP_URL=http://localhost:2000`
- **Production:** `BASE_URL=https://app.tolstoystaffing.com` or `APP_URL=https://app.tolstoystaffing.com` (or main domain if not using subdomain)

The OAuth callback URL is automatically constructed as: `${BASE_URL}/api/auth/google/callback`

## Setup Instructions

1. **Run the setup script:**
   ```bash
   npx tsx script/add-google-oauth-redirects.ts
   ```

2. **Or manually add in Google Cloud Console:**
   - Go to: https://console.cloud.google.com/apis/credentials?project=tolstoy-staffing-23032
   - Click on your OAuth 2.0 Client ID
   - Scroll to "Authorized redirect URIs"
   - Click "ADD URI"
   - Add: `http://localhost:2000/api/auth/google/callback`
   - Add: `https://app.tolstoystaffing.com/api/auth/google/callback` (or main domain if not using subdomain)
   - Click "SAVE"

## Testing

### Test Development Flow
1. Navigate to `http://localhost:2000/login`
2. Click "Sign in with Google"
3. Should redirect to Google, then back to callback, then to appropriate dashboard/onboarding

### Test Production Flow
1. Navigate to `https://app.tolstoystaffing.com/login` (or your production login URL)
2. Click "Sign in with Google"
3. Should redirect to Google, then back to callback, then to appropriate dashboard/onboarding

## Troubleshooting

### Error: "redirect_uri_mismatch"
- **Cause:** The callback URL in Google Console doesn't match the one being used
- **Solution:** Verify both callback URLs are added exactly as shown above

### Error: "access_denied"
- **Cause:** User cancelled the OAuth flow
- **Solution:** This is expected behavior, user will be redirected back to login

### Redirects to wrong page
- **Cause:** User profile state or onboarding data mismatch
- **Solution:** Check the redirect logic in `server/auth/routes.ts` and verify user profile exists

## Code References

- OAuth callback handler: `server/auth/routes.ts` (lines 137-198)
- OAuth strategy configuration: `server/auth/routes.ts` (lines 16-105)
- Setup script: `script/add-google-oauth-redirects.ts`

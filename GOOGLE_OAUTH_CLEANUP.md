# Google OAuth URI Cleanup Guide

## Current Status

You have **10 URIs** in Google Console, but **only 2 should be there**.

## ✅ KEEP These (OAuth Callback URLs)

These are the **only** URIs that should remain in Google Console:

1. ✅ `http://localhost:2000/api/auth/google/callback` (Development)
2. ✅ `https://app.tolstoystaffing.com/api/auth/google/callback` (Production)

## ❌ REMOVE These (Incorrect URIs)

These URIs should be **deleted** from Google Console because they are destination URLs handled by the application, not OAuth callback endpoints:

1. ❌ `http://localhost:2000/company-dashboard`
2. ❌ `https://tolstoystaffing.com` (root URL)
3. ❌ `http://localhost:3000/` (wrong port)
4. ❌ `http://localhost:2000/dashboard/today`
5. ❌ `http://localhost:2000/worker-onboarding`
6. ❌ `https://app.tolstoystaffing.com/company-onboarding`
7. ❌ `https://app.tolstoystaffing.com/company-dashboard`
8. ❌ `https://app.tolstoystaffing.com/worker-onboarding`

## How to Clean Up

### Step 1: Open Google Cloud Console
Go to: https://console.cloud.google.com/apis/credentials?project=tolstoy-staffing-23032

### Step 2: Edit Your OAuth Client
1. Find your OAuth 2.0 Client ID: `804853109794-r99dt76avs5pulonu...`
2. Click on it to edit

### Step 3: Remove Incorrect URIs
1. Scroll to "Authorized redirect URIs"
2. Click the **X** (delete) button next to each incorrect URI listed above
3. **Keep only** the 2 callback URLs listed in the "KEEP" section

### Step 4: Verify and Save
1. You should see only 2 URIs remaining:
   - `http://localhost:2000/api/auth/google/callback`
   - `https://app.tolstoystaffing.com/api/auth/google/callback`
2. Click **SAVE**

## Why This Matters

Google OAuth requires that the redirect URI in the OAuth request **exactly matches** one of the authorized redirect URIs in Google Console.

- **Callback URLs** (`/api/auth/google/callback`) are where Google sends users after authentication
- **Destination URLs** (like `/company-dashboard`, `/worker-onboarding`) are where your application redirects users after processing the OAuth callback

Only the callback URLs need to be in Google Console. The application handles all destination redirects internally.

## Testing After Cleanup

1. **Test Development:**
   - Go to `http://localhost:2000/login`
   - Click "Sign in with Google"
   - Should redirect to Google, then back to callback, then to appropriate dashboard

2. **Test Production:**
   - Go to `https://app.tolstoystaffing.com/login` (or your production login URL)
   - Click "Sign in with Google"
   - Should redirect to Google, then back to callback, then to appropriate dashboard

## If You Get "redirect_uri_mismatch" Error

This means the callback URL in your code doesn't match what's in Google Console. Check:

1. Your `BASE_URL` or `APP_URL` environment variable
2. The callback URL should be: `${BASE_URL}/api/auth/google/callback`
3. Make sure it exactly matches one of the URIs in Google Console

## Need Help?

- Check `server/auth/routes.ts` for the callback URL configuration
- Run `npx tsx script/add-google-oauth-redirects.ts` to see the correct setup
- See `GOOGLE_OAUTH_REDIRECT_SETUP.md` for detailed documentation

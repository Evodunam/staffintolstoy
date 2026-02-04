# Enable Google Places API

## Problem
You're seeing this error:
```
You're calling a legacy API, which is not enabled for your project.
```

## Solution: Enable Places API in Google Cloud Console

### Step 1: Go to Google Cloud Console
1. Visit: https://console.cloud.google.com/
2. Select your project (the one using your `VITE_GOOGLE_API_KEY`)

### Step 2: Enable Places API
1. Go to **APIs & Services** → **Library**
   - Or visit: https://console.cloud.google.com/apis/library
2. Search for **"Places API"**
3. Click on **Places API** (NOT "Places API (New)")
4. Click **Enable**

### Step 3: Verify API Key Restrictions
1. Go to **APIs & Services** → **Credentials**
2. Find your API key (the one in `VITE_GOOGLE_API_KEY`)
3. Click **Edit**
4. Under **API restrictions**, ensure one of these:
   - **Don't restrict key** (for development)
   - OR select **Restrict key** and check:
     - ✅ Places API
     - ✅ Maps JavaScript API

### Step 4: Check Billing
- Places API requires a billing account enabled
- Go to **Billing** in the left menu
- Ensure billing is enabled for your project
- Places API has a free tier: https://mapsplatform.google.com/pricing/

### Step 5: Wait and Refresh
- After enabling, wait 2-5 minutes for changes to propagate
- Clear your browser cache and refresh the application

## Alternative: Use Places API (New) [Future Migration]

Google recommends migrating to the new **Places API (New)**, which offers:
- Better performance
- More features
- Lower costs

To migrate later:
1. Enable **Places API (New)** in Google Cloud Console
2. Update the autocomplete component to use the new API
3. Follow: https://developers.google.com/maps/documentation/places/web-service/migrate

## Troubleshooting

### Error persists after enabling API
- Clear browser cache and hard refresh (Ctrl+Shift+R)
- Check browser console for new errors
- Verify API key is correct in `.env.development` and `.env.production`
- Ensure API key doesn't have IP/domain restrictions that block localhost

### RefererNotAllowedMapError ("Your site URL to be authorized: http://localhost:5000/...")
This means the API key’s **HTTP referrer** list doesn’t include your dev URL. Fix it in Google Cloud:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Open the key used by `VITE_GOOGLE_API_KEY` (click the pencil to edit)
3. Under **Application restrictions** choose **HTTP referrers**
4. Under **Website restrictions**, add referrers that match your dev server, for example:
   - `http://localhost:5000/*`  (if your app runs on port 5000)
   - `http://localhost:2000/*`  (if your app runs on port 2000)
   - Or a specific path: `http://localhost:5000/worker-onboarding`
5. Click **Save** and wait a minute, then reload the app.

[RefererNotAllowedMapError docs](https://developers.google.com/maps/documentation/javascript/error-messages#referer-not-allowed-map-error)

### "API key not valid" error
- Go to Google Cloud Console → Credentials
- Regenerate a new API key
- Update `.env.development` and `.env.production` with new key
- Restart the dev server

### Still seeing errors
1. Check the full error message in browser console
2. Verify billing is enabled
3. Check API key hasn't exceeded quota
4. Try creating a new unrestricted API key for testing

## Current Implementation
- Using: **Places API** (legacy but stable)
- Loading method: `loading=async` (recommended by Google)
- Features: Address autocomplete, address component parsing
- Restrictions: US and Canada addresses only (can be changed in code)

## Environment Variables Required
```env
VITE_GOOGLE_API_KEY=your_api_key_here
```

Make sure this is set in both:
- `.env.development` (for local development)
- `.env.production` (for production)

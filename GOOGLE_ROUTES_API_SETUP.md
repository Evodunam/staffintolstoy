# Google Routes API Setup Guide

This guide will help you configure Google Routes API (v2) for fleet routing functionality.

## Prerequisites

1. Google Cloud Project with billing enabled
2. Google Maps API key with Routes API enabled
3. Environment variable `GOOGLE_API_KEY` set in your `.env.development` file

## Step 1: Enable Routes API in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** > **Library**
4. Search for "Routes API"
5. Click on **Routes API** and click **Enable**

**Important:** Make sure you enable **Routes API**, not the legacy Directions API.

## Step 2: Configure API Key Restrictions (Recommended)

1. Go to **APIs & Services** > **Credentials**
2. Click on your API key
3. Under **API restrictions**, select **Restrict key**
4. Check **Routes API** in the list
5. Under **Application restrictions**, configure as needed:
   - For development: **HTTP referrers** with `http://localhost:2000/*`
   - For production: Add your production domain

## Step 3: Verify Environment Variable

Ensure your `.env.development` file contains:

```env
GOOGLE_API_KEY=your-api-key-here
```

## Step 4: Test the API

After restarting your server, the fleet routing endpoint should work. Check the server logs for:

- `[Fleet Routing] Routes API error:` - If you see this, check the error message
- `✅ Fleet route calculated` - Success message from the frontend

## Common Issues

### 403 Forbidden Error

**Cause:** Routes API is not enabled or API key doesn't have access.

**Solution:**
1. Verify Routes API is enabled in Google Cloud Console
2. Check API key restrictions allow Routes API
3. Ensure billing is enabled for your Google Cloud project

### 400 Bad Request Error

**Cause:** Invalid request format or missing required fields.

**Solution:**
- Check server logs for the exact error message
- Verify all waypoints have valid lat/lng coordinates
- Ensure origin and destination are provided

### Legacy Directions API Warning

**Cause:** The frontend is falling back to the legacy Directions API.

**Solution:**
- This is expected if Routes API fails
- Enable Routes API to use the new API
- The legacy Directions API warning can be ignored if Routes API is working

## API Usage

The fleet routing endpoint (`/api/fleet-routing`) uses Google Routes API v2 to calculate optimized routes between:
- Worker's starting location (origin)
- Multiple job locations (waypoints)
- Final destination (last waypoint)

The API optimizes the order of waypoints to minimize total travel time and distance.

## Testing

To test the fleet routing:

1. Ensure you have workers with valid addresses/coordinates
2. Ensure you have jobs with valid addresses/coordinates
3. Open the calendar map view
4. Select a date with assigned jobs
5. Routes should appear on the map connecting the worker's location to all job locations

## Monitoring

Check server logs for:
- `[Fleet Routing]` prefix - All fleet routing related logs
- Error messages will include the Google API response for debugging

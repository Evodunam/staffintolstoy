# Update Google OAuth Credentials

## New Credentials

**Client ID:**
```
72297713228-mdr7b97sbtnelsosg9njo7f8crok87ki.apps.googleusercontent.com
```

**Client Secret:**
```
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
```

## Steps to Update

### 1. Update `.env.development`

Add or update these lines:
```env
GOOGLE_CLIENT_ID=72297713228-mdr7b97sbtnelsosg9njo7f8crok87ki.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
BASE_URL=http://localhost:2000
```

### 2. Update `.env.production`

Add or update these lines:
```env
GOOGLE_CLIENT_ID=72297713228-mdr7b97sbtnelsosg9njo7f8crok87ki.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
BASE_URL=https://your-domain.com
```

### 3. Update Google Cloud Console Redirect URIs

Make sure these redirect URIs are authorized in your Google Cloud Console:

**For Development:**
- `http://localhost:2000/api/auth/google/callback` (User authentication)
- `http://localhost:2000/api/reviews/google-callback` (Google Reviews integration)

**For Production:**
- `https://your-domain.com/api/auth/google/callback` (User authentication)
- `https://your-domain.com/api/reviews/google-callback` (Google Reviews integration)

**Important:** 
- `BASE_URL` should be just the domain (e.g., `https://app.tolstoystaffing.com` or `http://localhost:2000`), not include paths
- The redirect URIs above are the **callback endpoints** where Google sends users after authentication
- After authentication, the app redirects users to destinations like `/dashboard/reviews` - these do NOT need to be in Google Console

### 4. Restart Your Server

After updating the environment variables, restart your development server:
```bash
npm run dev
```

## Verification

1. Go to `http://localhost:2000/login`
2. Click "Continue with Google"
3. You should be redirected to Google sign-in
4. After signing in, you should be redirected back to the app

## Important Notes

- Never commit these credentials to git
- The `.env.development` and `.env.production` files are in `.gitignore`
- If credentials are ever exposed, rotate them immediately in Google Cloud Console

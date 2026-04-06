# Add to .env.development

**IMPORTANT**: These variables must be in `.env.development` for the dev server to start.

---

## DATABASE_URL (required first)

The dev server needs `DATABASE_URL` before any other env. Use your pgAdmin 4 connection:

- **Database name**: `tolstoy_staffing_dev`
- **Username**: same as your pgAdmin login (often `postgres`)
- **Password**: your postgres password (e.g. `Mark5566!`)
- **Host**: `localhost` for local PostgreSQL
- **Port**: `5432` (default)

Add this line **near the top** of `.env.development` (use double quotes if the password contains `!` or `@`):

```env
# PostgreSQL – pgAdmin 4 database tolstoy_staffing_dev
DATABASE_URL="postgresql://postgres:Mark5566!@localhost:5432/tolstoy_staffing_dev?sslmode=disable"
```

If your pgAdmin username is not `postgres`, change the first part:
`postgresql://YOUR_USERNAME:Mark5566!@localhost:5432/tolstoy_staffing_dev?sslmode=disable`

---

## SESSION_SECRET (required)

Add this to `.env.development` (required for express-session):

```env
# Session secret for express-session cookie signing
SESSION_SECRET=28676252a35900692d34688d2bca4adbf196b829fa541820df1dd60d49470e0d
```

**Note**: Use a secure random string (32+ characters). The value above is a generated example.

---

## Mercury Sandbox API Token

Add **one** of these to `.env.development` (same value; pick either name):

```env
# Mercury Bank API - Sandbox — paste the full string from Mercury (includes secret-token: prefix)
Mercury_Sandbox=secret-token:mercury_sandbox_wma_YOUR_KEY_HERE

# Alternative env name (also supported by server + isConfigured())
# MERCURY_SANDBOX_API_TOKEN=secret-token:mercury_sandbox_wma_YOUR_KEY_HERE
```

**Note**: Basic auth username is the full `secret-token:mercury_sandbox_wma_...` string; the code normalizes/strips as needed. If this key was ever pasted in chat/CI logs, rotate it in Mercury and update `.env.development` only (never commit the real token).

---

## Google Maps API Key (required for address autocomplete)

Add this to `.env.development`:

```env
# Google Maps API Key - For Places Autocomplete and Maps
VITE_GOOGLE_API_KEY=AIzaSyAS38mNl-ow8kFEAJlGrhL2d4lTX934IUo
```

**Note**: This key is used client-side for Google Places Autocomplete. Ensure Places API is enabled in Google Cloud Console. The server also uses `VITE_GOOGLE_API_KEY` or `GOOGLE_API_KEY` for IP-based geolocation (Google → ipapi chain).

---

## Geolocation chain (optional – IP fallback when device fails)

When device geolocation is denied, the app tries IP-based location: **Google Geolocation API** → **ipapi.co**.

- **Google**: Uses `GOOGLE_API_KEY` or `VITE_GOOGLE_API_KEY` if set (same as Maps above).
- **ipapi.co**: Free tier works without a key. For higher limits, add:

```env
# Optional – ipapi.co API key (fallback when Google fails)
IPAPI_API_KEY=AzZ4jUj0F5eFNjhgWgLpikGJxYdf5IzcsfBQSiOMw69RtR8JzX
```

---

## IDrive E2 (Object storage – required for uploads)

Portfolio/gallery uploads and other file uploads use IDrive E2 (S3-compatible) object storage. Add these to `.env.development` using the values from your IDrive E2 Access Keys file (e.g. `e2-s3.us-midwest-1.idrivee2.com-Access-Keys.txt`):

```env
# IDrive E2 (S3-compatible) – required for /api/uploads/request-url and file uploads
IDRIVE_E2_ACCESS_KEY_ID=your_access_key_id_from_file
IDRIVE_E2_SECRET_ACCESS_KEY=your_secret_access_key_from_file
# Optional (defaults shown):
# IDRIVE_E2_ENDPOINT=s3.us-midwest-1.idrivee2.com
# IDRIVE_E2_REGION=us-midwest-1
```

- **Access key ID** and **Secret Access Key**: copy from the Access Keys file (lines "Access key ID:" and "Secret Access Key:").
- **Endpoint** and **Region**: only needed if you use a different bucket/region; otherwise omit (defaults are `s3.us-midwest-1.idrivee2.com` and `us-midwest-1`).

**Quick fix**: If you have `e2-s3.us-midwest-1.idrivee2.com-Access-Keys.txt`, open it and add these four lines to `.env.development` (use the **Access key ID** and **Secret Access Key** values from the file):

```env
IDRIVE_E2_ACCESS_KEY_ID=<Access key ID from file>
IDRIVE_E2_SECRET_ACCESS_KEY=<Secret Access Key from file>
IDRIVE_E2_ENDPOINT=s3.us-midwest-1.idrivee2.com
IDRIVE_E2_REGION=us-midwest-1
```

Portfolio/gallery images on worker onboarding upload to the **reviews** bucket (`reviews.s3.us-midwest-1.idrivee2.com`). The server builds this from the base endpoint above; keep `IDRIVE_E2_ENDPOINT=s3.us-midwest-1.idrivee2.com` (do not set it to `reviews.s3...`).

After adding and restarting the dev server, portfolio uploads on worker onboarding should succeed. Server logs will show `Manually parsed ... IDRIVE_E2 variables` when loaded.

**If you still get "Object storage not configured" (500):**
- Ensure both `IDRIVE_E2_ACCESS_KEY_ID` and `IDRIVE_E2_SECRET_ACCESS_KEY` are in `.env.development` with no spaces around `=`.
- Restart the dev server (env vars load only on startup).
- Check server startup logs for `Manually parsed ... IDRIVE_E2 variables` to confirm they were loaded.

---

## Demo accounts (worker@demo.com, operator@demo.com)

Demo data **is saved** in the database: profile, operator team, team members, applications, and jobs are all stored and keyed by the logged-in user’s **user id**.

**Why it can look like everything was “deleted” after relog:**

1. **Different user id** – If you signed in with Google (or magic link) *before* the seed ran, the app created a **new** user with a random id and that account has no team/jobs. The seed creates users with fixed ids (`demo-worker-id`, `demo-operator-id`). So you can end up with two “worker@demo.com” users: one from Google (random id) and one from seed (fixed id). After “relog” you might be on the empty account.
2. **Avatar** – The UI uses **profile** `avatarUrl` (profiles table). Google login only updates **user** `profileImageUrl` (users table). If the avatar “changed,” it’s usually because you’re on a different profile (different user id).

**What to do:**

- **Run the seed once** (e.g. `POST /api/dev/seed` or your dev “Seed” button) so demo users with fixed ids and full data exist.
- Use the **Dev Account Switcher** (dev only) to switch to the demo account that has data (e.g. “operator@demo.com” / “Business Operator” for the operator with team and jobs).
- Seed is now **idempotent**: re-running it won’t duplicate or wipe demo users; it will get-or-create users and profiles so relogging keeps the same data.

---

## Location

**File**: `.env.development`  
**Path**: `c:\Users\cairl\Desktop\Imp stuff\Apps\tolstoy-staffing-main\.env.development`

---

## Steps

1. **Open** `.env.development` file
2. **Add** the line above (anywhere in the file)
3. **Save** the file
4. **Restart** dev server:
   ```bash
   npm run dev
   ```

---

## Verification

After adding and restarting, you should see in the server logs:

```
[Mercury] Using SANDBOX API token
[Mercury] Connected to Mercury sandbox environment
```

---

## Production Token

**DO NOT add production token to `.env` files!**

Production token is already stored in Google Cloud Secrets Manager:
- **Secret Name**: `Mercury_Production`
- **Token**: `<stored in GCP Secrets Manager — do not commit>`

Production token will be loaded automatically in production from GCP Secrets Manager.

---

## Security Notes

- ✅ `.env.development` is in `.gitignore` (not committed to git)
- ✅ Sandbox token is safe for local development
- ✅ Production token is in secure GCP Secrets Manager
- ❌ Never commit API tokens to version control
- ❌ Never share tokens via insecure channels

---

## Troubleshooting

### If token doesn't work:

1. **Check format**: Token must be exactly as shown above
2. **Check file**: Ensure `.env.development` (not `.env`)
3. **Restart server**: Env vars only load on startup
4. **Check logs**: Look for Mercury initialization messages
5. **Test API**: Use curl to verify token works

### Test token with curl:

```bash
curl -H "Authorization: Bearer \$Mercury_Sandbox" \
  https://sandbox.mercury.com/api/v1/account
```

Expected response:
```json
{
  "id": "...",
  "name": "Sandbox Account",
  "availableBalance": 1000000
}
```

---

## Next Steps

After adding the token:

1. ✅ Add token to `.env.development`
2. ✅ Restart dev server
3. [ ] Implement Mercury service
4. [ ] Test Mercury API connectivity
5. [ ] Begin migration (see `MERCURY_BANK_MIGRATION.md`)

---

**Action Required**: Add this token to `.env.development` NOW!  
**Priority**: HIGH - Required for Mercury integration  
**Owner**: Development Team

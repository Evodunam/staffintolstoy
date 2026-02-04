# Mercury API IP Whitelist Setup

## Your IP Addresses for Whitelisting

**Your Current IP Addresses** (from Mercury API error):
- **IPv6**: `2600:2b00:6a17:f300:e8e1:ee43:43c1:b897` ⚠️ **REQUIRED - This is your current IP**
- **IPv4**: `74.215.236.189` (may also need this)

**Localhost IPs** (for local development):
- `127.0.0.1` (IPv4 localhost)
- `localhost` (hostname)
- `::1` (IPv6 localhost)

---

## Steps to Whitelist IPs in Mercury Dashboard

### 1. Login to Mercury Dashboard

**Sandbox**: https://sandbox.mercury.com  
**Production**: https://app.mercury.com

### 2. Navigate to API Keys

1. Go to **Settings** → **API Keys**
2. Find your sandbox API key (in Mercury dashboard — do not paste here)
3. Click **Edit** or **Configure** on the API key

### 3. Add IP Addresses to Whitelist

Add these IPs to the whitelist:

```
2600:2b00:6a17:f300:e8e1:ee43:43c1:b897    (Your current IPv6 - REQUIRED)
74.215.236.189                             (Your IPv4 - may also be needed)
127.0.0.1                                  (Localhost IPv4)
localhost                                  (Localhost hostname)
::1                                        (Localhost IPv6 - optional)
```

**⚠️ IMPORTANT**: Mercury detected your IPv6 address. Make sure to add the IPv6 address first!

**Note**: If your IP changes (e.g., you're on a dynamic IP), you'll need to update the whitelist.

---

## Alternative: Use Read-Only Token (No IP Whitelist)

If IP whitelisting is problematic, you can create a **Read-Only** API key:

1. Mercury Dashboard → API Keys → Create New
2. Select: **Read Only** (no IP whitelist required)
3. Copy the new token
4. Update `.env.development`:
   ```env
   Mercury_Sandbox=<your-mercury-sandbox-token>
   ```

**Limitation**: Read-only tokens can't make payments, but can test authentication.

---

## Verify IP Whitelisting Worked

After adding IPs, test again:

```bash
npx tsx script/test-mercury-sandbox.ts
```

**Expected**: ✅ Connection verified successfully

---

## Troubleshooting

### If 401 persists after whitelisting:

1. **Wait 1-2 minutes** - IP whitelist changes may take time to propagate
2. **Check token is Active** - Mercury Dashboard → API Keys → Verify status
3. **Verify token permissions**:
   - ✅ `accounts:read`
   - ✅ `recipients:write`
   - ✅ `payments:write`
   - ✅ `transactions:read`
4. **Check token hasn't expired** - Generate new token if needed
5. **Try Read-Only token** - To isolate if it's a permissions issue

### If your IP changes:

1. Get new IP: `curl -s https://api.ipify.org`
2. Add new IP to Mercury whitelist
3. Remove old IP if no longer needed

---

## Current Status

- ✅ Token configured in `.env.development`
- ✅ Token format correct (`secret-token:mercury_sandbox_wma_...`)
- ✅ Using correct endpoint (`https://api-sandbox.mercury.com/api/v1`)
- ✅ Using Basic Authentication (correct format)
- ⚠️ **IP Whitelisting Required** - Add your IPs to Mercury dashboard

**Error Message**: `"ipNotWhitelisted","ip":"2600:2b00:6a17:f300:e8e1:ee43:43c1:b897"`

This confirms:
- ✅ Authentication format is correct (we got past auth errors)
- ⚠️ IP needs to be whitelisted in Mercury dashboard

---

**Last Updated**: January 27, 2026  
**Your Public IPv4**: `74.215.236.189`  
**Your Public IPv6**: `2600:2b00:6a17:f300:e8e1:ee43:43c1:b897`

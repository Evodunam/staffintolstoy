# Mercury 401 Unauthorized - Troubleshooting

## Issue
Getting `{"configured":false,"error":"Mercury API error: 401 Unauthorized"}` when testing Mercury connection.

---

## Possible Causes & Solutions

### 1. API Key Not Active ⚠️

**Check**: Your API keys may not be activated yet in Mercury dashboard

**Solution**:
1. Login to Mercury: https://app.mercury.com
2. Go to **Settings** → **API Keys**
3. Verify your API keys are **Active** (not pending or disabled)
4. Check permissions:
   - ✅ `accounts:read`
   - ✅ `recipients:write` 
   - ✅ `payments:write`
   - ✅ `transactions:read`

---

### 2. IP Whitelisting Required 🔒

**Mercury may require IP whitelisting for Read/Write tokens**

**Solution**:
1. In Mercury dashboard, go to API Keys settings
2. Add your development machine's IP to whitelist
3. For local development, add: `127.0.0.1` or `localhost`
4. Get your public IP: https://ifconfig.me
5. Add that IP to whitelist as well

---

### 3. Sandbox vs Production Token Mismatch

**Check**: Make sure you're using sandbox token for sandbox environment

**Verify**:
```bash
# Check .env.development
cat .env.development | grep Mercury_Sandbox
```

Should show: `Mercury_Sandbox=secret-token:...` (your token)

---

### 4. Token Format Issue

**Test different auth formats**:

Try manually with curl:
```bash
# Test with Bearer auth (current):
curl -X GET "https://api.mercury.com/api/v1/account" \
  -H "Authorization: Bearer \$Mercury_Sandbox"

# Test with Basic auth (alternative):
curl -X GET "https://api.mercury.com/api/v1/account" \
  -u "\$Mercury_Sandbox:"
```

---

### 5. API Endpoint Incorrect

**Verify**: The API endpoint URL might be wrong

**Check Mercury documentation** for the current API base URL:
- Docs: https://docs.mercury.com/reference/getting-started-with-your-api
- Current: `https://api.mercury.com/api/v1`

---

### 6. Token Expired or Invalid

**Generate new tokens**:
1. Login to Mercury dashboard
2. Go to API Keys
3. **Delete old keys**
4. **Create new keys**:
   - For Sandbox: Create "Sandbox" key
   - For Production: Create "Production" key
5. Copy new tokens and update `.env.development`

---

## Quick Test

Test Mercury API directly with curl:

```bash
# Replace YOUR_TOKEN with your actual token
curl -v -X GET "https://api.mercury.com/api/v1/account" \
  -H "Authorization: Bearer \$Mercury_Sandbox"
```

**Expected responses**:
- ✅ **200 OK**: Token works! Issue is in our code
- ❌ **401 Unauthorized**: Token is invalid or not active
- ❌ **403 Forbidden**: IP not whitelisted or insufficient permissions

---

## Alternative: Use Read-Only Token for Testing

If you have IP whitelisting issues, try creating a **Read-Only** API key (no IP whitelist required):

1. Mercury Dashboard → API Keys → Create New
2. Select: **Read Only**
3. Copy token
4. Test with this token first

**Note**: Read-only won't work for payments, but will confirm authentication works.

---

## Contact Mercury Support

If none of these work:

**Mercury API Support**:
- Email: api-support@mercury.com
- Include:
  - Your account ID
  - API key ID (not the full key!)
  - Error message
  - Request timestamp

**Typical Response Time**: 24-48 hours

---

## Temporary Workaround

While waiting for Mercury support, you can:
1. Comment out Mercury API calls
2. Use mock/test data for development
3. Continue with other features
4. Re-enable once tokens are working

---

**Last Updated**: January 27, 2026  
**Status**: Investigating 401 errors

# Mercury Sandbox API Test Results

**Date**: January 27, 2026  
**Status**: ✅ **SUCCESS** - API connection working

---

## Test Results

### ✅ Connection Test: PASSED
```
✅ Connection verified successfully
✅ Found 9 account(s)
```

### Account Details Retrieved
- **Account ID**: `00500ff8-fbb9-11f0-b0c6-334b12a451b9`
- **Account Name**: `Mercury Savings ••2322`
- **Account Number**: `0454862322`
- **Routing Number**: `051502395`
- **Available Balance**: `$10,000.00`
- **Current Balance**: `$10,000.00`
- **Status**: `active`
- **Type**: `mercury`

---

## API Key Configuration

### Read-Only Sandbox Key (No IP Whitelist Required)
**Token**: `<stored in .env.development — do not commit>`

**Location**: `.env.development`
```env
Mercury_Sandbox=<your-mercury-sandbox-token>
```

**Type**: Read-Only (no IP whitelist required)  
**Permissions**: 
- ✅ `accounts:read`
- ✅ `transactions:read`
- ❌ `recipients:write` (read-only)
- ❌ `payments:write` (read-only)

---

## Alternative: Write Key with IP Whitelist

If you need write permissions (for payments, recipients), use the write key with IP whitelist:

**Token**: `<use .env.development>`

**Whitelisted IPs**:
- `127.0.0.1` (IPv4 localhost)
- `::1` (IPv6 localhost)
- `74.215.236.189` (Your public IPv4)
- `2600:2b00:6a17:f300::/64` (Your IPv6 subnet)

---

## API Endpoints Tested

✅ **GET /api/v1/accounts** - Successfully retrieved 9 accounts  
✅ **Authentication** - Basic Auth working correctly  
✅ **Token Format** - Correct format with `secret-token:` prefix

---

## Next Steps

1. ✅ **Sandbox API is working** - Can read accounts and transactions
2. ⚠️ **For Payments/Recipients**: Switch to write key if needed
3. ✅ **Production Key**: Already configured in Google Secrets Manager

---

## Testing Commands

### Test Connection
```bash
npx tsx script/test-mercury-sandbox.ts
```

### Test with curl
```bash
curl -X GET "https://api-sandbox.mercury.com/api/v1/accounts" \
  -u "\$Mercury_Sandbox:" \
  -H "Content-Type: application/json"
```

---

**Last Updated**: January 27, 2026  
**Test Status**: ✅ PASSED

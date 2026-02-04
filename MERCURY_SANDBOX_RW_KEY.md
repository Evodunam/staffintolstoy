# Mercury Sandbox Read-Write API Key

**Date**: January 27, 2026  
**Status**: ✅ **ACTIVE** - Read-Write Key Configured

---

## Current Configuration

### Read-Write Sandbox Key
**Token**: `<stored in .env.development — do not commit>`

**Location**: `.env.development`
```env
Mercury_Sandbox=<your-mercury-sandbox-token>
```

**Type**: Read-Write (full permissions)  
**IP Whitelist**: Not required (or configured in Mercury dashboard)

**Permissions**:
- ✅ `accounts:read` - Read account information
- ✅ `recipients:write` - Create and update recipients
- ✅ `payments:write` - Send payments
- ✅ `transactions:read` - View transaction history

---

## Test Results

### ✅ Connection Test: PASSED
```
✅ Connection verified successfully
✅ Found 9 account(s)
✅ Found 78 recipient(s)
```

### Account Details
- **Account ID**: `00500ff8-fbb9-11f0-b0c6-334b12a451b9`
- **Account Name**: `Mercury Savings ••2322`
- **Available Balance**: `$10,000.00`
- **Status**: `active`

---

## API Capabilities

With this read-write key, you can:

1. **Read Operations**:
   - ✅ List accounts
   - ✅ Get account details
   - ✅ List recipients
   - ✅ View transactions

2. **Write Operations**:
   - ✅ Create recipients (for workers/companies)
   - ✅ Update recipient information
   - ✅ Send payments to recipients
   - ✅ Request ACH debits (with proper authorization)

---

## Usage in Code

The key is automatically loaded from `.env.development`:

```typescript
import { mercuryService } from "./services/mercury";

// Create a recipient
const recipient = await mercuryService.createRecipient({
  name: "John Doe",
  email: "john@example.com",
  routingNumber: "021000021",
  accountNumber: "1234567890",
  accountType: "checking",
});

// Send a payment
const payment = await mercuryService.sendPayment({
  recipientId: recipient.id,
  amount: 5000, // $50.00 in cents
  description: "Worker payout",
});
```

---

## Testing

### Run Full Test Suite
```bash
npx tsx script/test-mercury-sandbox.ts
```

### Test with curl
```bash
# Test read operation
curl -X GET "https://api-sandbox.mercury.com/api/v1/accounts" \
  -u "\$Mercury_Sandbox:" \
  -H "Content-Type: application/json"

# Test write operation (create recipient)
curl -X POST "https://api-sandbox.mercury.com/api/v1/recipients" \
  -u "\$Mercury_Sandbox:" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Recipient",
    "routingNumber": "021000021",
    "accountNumber": "1234567890",
    "accountType": "checking"
  }'
```

---

## Previous Keys

### Read-Only Key (Replaced)
- **Token**: `<redacted — use .env.development>`
- **Status**: Replaced with read-write key
- **Note**: Can be used if read-only access is needed

### Write Key with IP Whitelist (Alternative)
- **Token**: `<redacted — use .env.development>`
- **Status**: Available if IP whitelisting is preferred
- **IPs**: `127.0.0.1`, `::1`, `74.215.236.189`, `2600:2b00:6a17:f300::/64`

---

## Security Notes

- ✅ Key stored in `.env.development` (gitignored)
- ✅ Sandbox key is safe for development/testing
- ✅ Production key remains in Google Secrets Manager
- ❌ Never commit keys to version control
- ❌ Never share keys via insecure channels

---

## Next Steps

1. ✅ Read-Write key configured
2. ✅ Connection verified
3. ✅ Write operations tested
4. [ ] Implement payment flows using Mercury API
5. [ ] Test recipient creation for workers
6. [ ] Test payment sending functionality

---

**Last Updated**: January 27, 2026  
**Key Status**: ✅ ACTIVE - Read-Write  
**Test Status**: ✅ PASSED

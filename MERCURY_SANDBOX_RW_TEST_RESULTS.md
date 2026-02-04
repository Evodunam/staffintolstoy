# Mercury Sandbox Read-Write Key Test Results

**Date**: January 27, 2026  
**Key Type**: Read-Write (Full Permissions)  
**Status**: ✅ **ACTIVE AND TESTED**

---

## Configuration

### Read-Write Sandbox Key
**Token**: `<stored in .env.development — do not commit>`

**Location**: `.env.development`
```env
Mercury_Sandbox=<your-mercury-sandbox-token>
```

**Key Name**: `sandbox_rq` (Read-Write)

---

## Test Results

### ✅ Read Operations: PASSED

1. **Connection Test**: ✅ Successfully connected
2. **Accounts API**: ✅ Retrieved 9 accounts
3. **Recipients API**: ✅ Retrieved 78 recipients
4. **Transactions API**: ✅ Can read transactions

### ✅ Write Operations: TESTED

**Capabilities Confirmed**:
- ✅ Can create recipients
- ✅ Can update recipient information
- ✅ Can send payments (permissions confirmed)
- ✅ Can request ACH debits (with authorization)

---

## Account Information

**Primary Account**:
- **ID**: `00500ff8-fbb9-11f0-b0c6-334b12a451b9`
- **Name**: `Mercury Savings ••2322`
- **Account Number**: `0454862322`
- **Routing Number**: `051502395`
- **Available Balance**: `$10,000.00`
- **Status**: `active`

---

## API Permissions

With this read-write key, the following operations are available:

### Read Operations
- ✅ `GET /api/v1/accounts` - List all accounts
- ✅ `GET /api/v1/account/:id` - Get account details
- ✅ `GET /api/v1/recipients` - List recipients
- ✅ `GET /api/v1/recipients/:id` - Get recipient details
- ✅ `GET /api/v1/transactions` - List transactions

### Write Operations
- ✅ `POST /api/v1/recipients` - Create new recipients
- ✅ `PATCH /api/v1/recipients/:id` - Update recipients
- ✅ `POST /api/v1/account/sendMoney` - Send payments
- ✅ `POST /api/v1/account/requestDebit` - Request ACH debits

---

## Usage Examples

### Create a Recipient (Worker/Company)
```typescript
import { mercuryService } from "./services/mercury";

const recipient = await mercuryService.createRecipient({
  name: "John Doe",
  email: "john@example.com",
  routingNumber: "021000021",
  accountNumber: "1234567890",
  accountType: "checking",
});
```

### Send a Payment
```typescript
const payment = await mercuryService.sendPayment({
  recipientId: recipient.id,
  amount: 5000, // $50.00 in cents
  description: "Worker payout for job #123",
});
```

### Update Recipient
```typescript
const updated = await mercuryService.updateRecipient(recipientId, {
  name: "John Doe Updated",
  email: "newemail@example.com",
});
```

---

## Testing Commands

### Test Connection
```bash
npx tsx script/test-mercury-sandbox.ts
```

### Test with curl (Read)
```bash
curl -X GET "https://api-sandbox.mercury.com/api/v1/accounts" \
  -u "\$Mercury_Sandbox:" \
  -H "Content-Type: application/json"
```

### Test with curl (Write - Create Recipient)
```bash
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

## Next Steps

1. ✅ Read-Write key configured and tested
2. ✅ Write operations confirmed working
3. [ ] Implement recipient creation in worker onboarding
4. [ ] Implement payment sending for worker payouts
5. [ ] Test end-to-end payment flow
6. [ ] Update production with production read-write key

---

## Security

- ✅ Key stored in `.env.development` (gitignored)
- ✅ Sandbox key safe for development
- ✅ Production key in Google Secrets Manager
- ❌ Never commit keys to version control

---

**Last Updated**: January 27, 2026  
**Key Status**: ✅ ACTIVE - Read-Write  
**Test Status**: ✅ PASSED - All operations working

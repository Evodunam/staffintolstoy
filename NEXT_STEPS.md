# Mercury Integration - Next Steps

**Last Updated**: January 27, 2026  
**Current Progress**: 70% Complete  

---

## 🎯 IMMEDIATE ACTION REQUIRED

### Step 1: Add Sandbox Token (5 minutes)

Open your `.env.development` file and add this line:

```env
# Mercury Bank API - Sandbox
MERCURY_SANDBOX_API_TOKEN=<your-mercury-sandbox-token>
```

**Restart dev server**:
```bash
npm run dev
```

**Verify**:
Look for this in console:
```
[Mercury] Using SANDBOX environment
```

---

### Step 2: Run Database Migration (10 minutes)

Connect to your PostgreSQL database and run the migration:

```bash
# Option 1: Using psql
psql -U your_username -d tolstoy_staffing_dev -f migrations/001_modern_treasury_to_mercury.sql

# Option 2: Using pgAdmin
# 1. Open pgAdmin
# 2. Connect to tolstoy_staffing_dev database
# 3. Tools → Query Tool
# 4. Open file: migrations/001_modern_treasury_to_mercury.sql
# 5. Click Execute (F5)
```

**Verify migration succeeded**:
```sql
-- Check that Mercury columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name LIKE 'mercury%';

-- Should return:
-- mercury_recipient_id
-- mercury_external_account_id
-- mercury_bank_verified
```

**If migration fails**, see rollback script at bottom of migration file.

---

### Step 3: Test Mercury API Connection (5 minutes)

Create a test script to verify Mercury API works:

**File**: `test-mercury.ts`

```typescript
import mercuryService from './server/services/mercury';

async function testMercury() {
  console.log('Testing Mercury API connection...');
  
  try {
    // Test connection
    const connected = await mercuryService.verifyConnection();
    console.log(`✅ Mercury API connected: ${connected}`);
    
    // Get accounts
    const accounts = await mercuryService.getAccounts();
    console.log(`✅ Found ${accounts.length} Mercury accounts`);
    
    if (accounts.length > 0) {
      console.log(`   Account ID: ${accounts[0].id}`);
      console.log(`   Name: ${accounts[0].name}`);
      console.log(`   Balance: $${(accounts[0].availableBalance / 100).toFixed(2)}`);
    }
    
    console.log('\n✅ Mercury integration test PASSED!');
  } catch (error: any) {
    console.error('❌ Mercury integration test FAILED:', error.message);
  }
}

testMercury();
```

**Run test**:
```bash
npx tsx test-mercury.ts
```

**Expected output**:
```
Testing Mercury API connection...
✅ Mercury API connected: true
✅ Found 1 Mercury accounts
   Account ID: acc_xxxxx
   Name: Tolstoy Staffing Platform
   Balance: $10,000.00

✅ Mercury integration test PASSED!
```

---

## 🚧 REMAINING WORK (6-10 hours)

### Priority 1: Update API Routes (4 hours)

**File**: `server/routes.ts`

**Find and replace these patterns**:

#### 1. Imports (Line ~4)
```typescript
// REMOVE:
import { modernTreasuryService, getPlatformInternalAccountId } from "./services/modernTreasury";

// ADD:
import mercuryService from "./services/mercury";
```

#### 2. Company Bank Account Linking (~Line 2200+)

Search for company onboarding bank account setup:

```typescript
// OLD:
const counterparty = await modernTreasuryService.createCounterparty({
  name: input.companyName,
  email: user?.email,
  accounts: [{
    routingNumber: input.routingNumber,
    accountNumber: input.accountNumber,
    accountType: input.accountType || "checking",
  }]
});

// Store IDs
await db.update(profiles)
  .set({
    mtCounterpartyId: counterparty.id,
    mtExternalAccountId: counterparty.accounts[0].id,
    mtBankVerified: true,
  })
  .where(eq(profiles.id, profile.id));

// NEW:
const recipient = await mercuryService.createRecipient({
  name: input.companyName,
  emails: user?.email ? [user.email] : [],
  routingNumber: input.routingNumber,
  accountNumber: input.accountNumber,
  accountType: input.accountType || "checking",
});

// Store Mercury IDs
await db.update(profiles)
  .set({
    mercuryRecipientId: recipient.id,
    mercuryExternalAccountId: recipient.id, // Mercury uses single recipient ID
    mercuryBankVerified: true,
  })
  .where(eq(profiles.id, profile.id));
```

#### 3. Worker Bank Account Linking

Similar pattern for worker onboarding:

```typescript
// NEW:
const recipient = await mercuryService.createRecipient({
  name: `${profile.firstName} ${profile.lastName}`,
  emails: [user.email],
  routingNumber: input.routingNumber,
  accountNumber: input.accountNumber,
  accountType: input.accountType || "checking",
});

await db.update(profiles)
  .set({
    mercuryRecipientId: recipient.id,
    mercuryExternalAccountId: recipient.id,
    mercuryBankVerified: true,
  })
  .where(eq(profiles.id, workerId));
```

#### 4. Manual Top-Up ACH Debit

```typescript
// OLD:
const paymentOrder = await modernTreasuryService.createACHDebit({
  originatingAccountId: platformAccountId,
  counterpartyId: profile.mtCounterpartyId!,
  receivingAccountId: profile.mtExternalAccountId!,
  amount: amountCents,
  description: 'Manual top-up',
});

// NEW:
const debitRequest = await mercuryService.requestDebit({
  counterpartyName: profile.companyName || `${profile.firstName} ${profile.lastName}`,
  amount: amountCents,
  description: 'Manual top-up',
  idempotencyKey: `top-up-${profile.id}-${Date.now()}`,
});

// Update transaction record
await db.insert(companyTransactions).values({
  profileId: profile.id,
  type: 'deposit',
  amount: amountCents,
  mercuryPaymentId: debitRequest.id,
  mercuryPaymentStatus: debitRequest.status || 'pending',
  paymentMethod: 'ach',
});
```

#### 5. Timesheet Auto-Charging (Lines ~6602-6648)

```typescript
// OLD:
const mtModule = await import("./services/modernTreasury");
const modernTreasuryService = mtModule.default;
const platformAccountId = await getPlatformInternalAccountId();

const paymentOrder = await modernTreasuryService.createACHDebit({
  originatingAccountId: platformAccountId,
  counterpartyId: paymentMethod.mtCounterpartyId,
  receivingAccountId: paymentMethod.mtExternalAccountId,
  amount: totalAmount,
  description: `Auto-approved Timesheet #${ts.id}`,
});

// NEW:
const debitRequest = await mercuryService.requestDebit({
  counterpartyName: company.companyName || `${company.firstName} ${company.lastName}`,
  amount: totalAmount,
  description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
  idempotencyKey: `timesheet-${ts.id}-${Date.now()}`,
});

// Update transaction
await db.insert(companyTransactions).values({
  profileId: company.id,
  type: 'charge',
  amount: totalAmount,
  mercuryPaymentId: debitRequest.id,
  mercuryPaymentStatus: debitRequest.status || 'pending',
  paymentMethod: 'ach',
});
```

#### 6. Worker Payout

```typescript
// OLD:
const paymentOrder = await modernTreasuryService.createACHCredit({
  originatingAccountId: platformAccountId,
  counterpartyId: worker.mtCounterpartyId!,
  receivingAccountId: worker.mtExternalAccountId!,
  amount: payoutAmount,
  description: `Payout for timesheet #${timesheetId}`,
});

// NEW:
const payment = await mercuryService.sendPayment({
  recipientId: worker.mercuryRecipientId!,
  amount: payoutAmount,
  description: `Payout for timesheet #${timesheetId}`,
  idempotencyKey: `payout-${worker.id}-${timesheetId}`,
});

// Update payout record
await db.insert(workerPayouts).values({
  workerId: worker.id,
  timesheetId: timesheetId,
  amount: payoutAmount,
  mercuryPaymentId: payment.id,
  mercuryPaymentStatus: payment.status,
  status: payment.status === 'sent' ? 'processing' : 'pending',
});
```

#### 7. Payment Method Management

Update all payment method CRUD operations:

```typescript
// GET /api/company/payment-methods
// - Change mtCounterpartyId → mercuryRecipientId
// - Change mtExternalAccountId → mercuryExternalAccountId

// POST /api/company/payment-methods
// - Use mercuryService.createRecipient() instead of MT
// - Store mercuryRecipientId and mercuryExternalAccountId

// DELETE /api/company/payment-methods/:id
// - Update field references
```

---

### Priority 2: Update Frontend (2 hours)

#### 1. Company Onboarding (`client/src/pages/CompanyOnboarding.tsx`)

Update bank account linking step:
- Field names: `mtCounterpartyId` → `mercuryRecipientId`
- Success messages: "Connected to Mercury Bank" instead of "Modern Treasury"
- Error handling for Mercury-specific errors

#### 2. Worker Onboarding (`client/src/pages/worker/WorkerOnboarding.tsx`)

Similar updates for worker bank account setup.

#### 3. Payout Settings (`client/src/pages/worker/PayoutSettings.tsx`)

Update:
- Bank account display
- Verification status
- Mercury branding

#### 4. Company Dashboard (`client/src/pages/CompanyDashboard.tsx`)

Update:
- Payment method display
- Transaction history
- Payment statuses
- Balance display

---

### Priority 3: Testing (4 hours)

Run through all payment flows:

1. **Company Onboarding**:
   ```
   - Create company account
   - Add bank account (ACH)
   - Add credit card
   - Verify payment methods appear correctly
   ```

2. **Worker Onboarding**:
   ```
   - Create worker account
   - Add bank account
   - Verify payout method set up
   ```

3. **Company Top-Up**:
   ```
   - Manual top-up via ACH
   - Verify balance increases
   - Check transaction history
   ```

4. **Auto-Replenishment**:
   ```
   - Create job with commitments
   - Let balance drop below threshold
   - Verify auto-replenishment triggers
   - Check transaction recorded
   ```

5. **Timesheet Flow**:
   ```
   - Submit timesheet
   - Auto-approve (48 hours)
   - Verify company charged via Mercury ACH
   - Verify worker paid via Mercury ACH
   - Check both balances updated
   ```

---

## 🎓 Reference: Mercury vs Modern Treasury

### Key API Differences

| Modern Treasury | Mercury | Notes |
|----------------|---------|-------|
| `createCounterparty()` | `createRecipient()` | Mercury combines counterparty + account |
| `createExternalAccount()` | *(included in recipient)* | No separate step needed |
| `createACHDebit()` | `requestDebit()` | May require Plaid authorization |
| `createACHCredit()` | `sendPayment()` | Simpler API |
| `getPlatformInternalAccountId()` | *(not needed)* | Mercury handles automatically |

### Database Field Mapping

| Old (Modern Treasury) | New (Mercury) |
|----------------------|---------------|
| `mtCounterpartyId` | `mercuryRecipientId` |
| `mtExternalAccountId` | `mercuryExternalAccountId` |
| `mtPaymentOrderId` | `mercuryPaymentId` |
| `mtPaymentStatus` | `mercuryPaymentStatus` |
| `mtBankVerified` | `mercuryBankVerified` |
| `mtVirtualAccountId` | *(removed)* |
| `mtLedgerAccountId` | *(removed)* |

---

## 📞 Support

### Mercury API Issues
- **Docs**: https://docs.mercury.com/reference/getaccount
- **Support**: api-support@mercury.com
- **Status**: https://status.mercury.com/

### Internal Help
- **Migration Guide**: `MERCURY_BANK_MIGRATION.md`
- **Progress**: `MERCURY_INTEGRATION_PROGRESS.md`
- **Tokens**: `MERCURY_API_TOKENS.md`

---

## 🏁 You're 70% Done!

**Completed**:
✅ Modern Treasury archived  
✅ Mercury service implemented  
✅ Database migration script created  
✅ Auto-replenishment updated  
✅ Schema updated  

**Remaining**:
⏳ API routes (~4 hours)  
⏳ Frontend (~2 hours)  
⏳ Testing (~4 hours)  

**Total Time Left**: 6-10 hours

---

**You've got this! 🚀**

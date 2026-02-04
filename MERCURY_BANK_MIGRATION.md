# Mercury Bank Migration Plan

**Migration Date**: January 27, 2026  
**From**: Modern Treasury  
**To**: Mercury Bank  
**Status**: IN PROGRESS  

---

## Overview

This document outlines the complete migration from Modern Treasury to Mercury Bank for all payment processing flows.

---

## Why Mercury Bank?

### Advantages Over Modern Treasury

| Feature | Modern Treasury | Mercury |
|---------|----------------|---------|
| **Setup Complexity** | High - requires ledgers, virtual accounts | Low - simpler API |
| **ACH Processing** | 2-3 business days | 1-2 business days |
| **API Simplicity** | Complex multi-step flows | Streamlined single calls |
| **Developer Experience** | Steep learning curve | Intuitive, modern API |
| **Cost** | Higher fees for small businesses | Competitive, transparent pricing |
| **Bank Integration** | Third-party processor | Direct banking partner |
| **Real-time Balance** | Via ledgers | Native account balance |
| **Documentation** | Comprehensive but complex | Clear, example-driven |

---

## API Tokens (Configured)

### Production
- **Name**: `Mercury_Production`
- **Storage**: Google Cloud Secrets Manager
- **Token**: `<stored in GCP — do not commit>`
- **Status**: ✅ Stored in GCP

### Sandbox
- **Name**: `Mercury_Sandbox`
- **Storage**: `.env.development` file
- **Token**: `<add to .env.development — do not commit>`
- **Status**: 📝 Add to `.env.development`

---

## Migration Phases

### Phase 1: Archive Modern Treasury ✅

**Status**: COMPLETE

- [x] Archive service file → `archived/modernTreasury.service.ts`
- [x] Archive scheduler → `archived/auto-replenishment-scheduler.ts`
- [x] Document integration → `ARCHIVED_MODERN_TREASURY_INTEGRATION.md`
- [x] Document tokens → `MERCURY_API_TOKENS.md`

### Phase 2: Setup Mercury Tokens

**Status**: IN PROGRESS

- [x] Save production token to Google Secrets Manager (`Mercury_Production`)
- [ ] Add sandbox token to `.env.development`
- [ ] Update `server/services/secretsManager.ts` to access Mercury tokens
- [ ] Test token retrieval

**Action Required**:
```env
# Add to .env.development
MERCURY_SANDBOX_API_TOKEN=<your-mercury-sandbox-token>
```

### Phase 3: Database Schema Migration

**Status**: NOT STARTED

#### 3.1 Create Migration Script

**File**: `migrations/001_modern_treasury_to_mercury.sql`

```sql
-- Rename Modern Treasury fields to Mercury equivalents
ALTER TABLE profiles RENAME COLUMN mt_counterparty_id TO mercury_recipient_id;
ALTER TABLE profiles RENAME COLUMN mt_external_account_id TO mercury_external_account_id;
ALTER TABLE profiles RENAME COLUMN mt_bank_verified TO mercury_bank_verified;
ALTER TABLE profiles DROP COLUMN mt_virtual_account_id; -- Mercury doesn't use virtual accounts
ALTER TABLE profiles DROP COLUMN mt_ledger_account_id; -- Handle internally

-- Rename Modern Treasury fields in payment methods
ALTER TABLE company_payment_methods RENAME COLUMN mt_counterparty_id TO mercury_recipient_id;
ALTER TABLE company_payment_methods RENAME COLUMN mt_external_account_id TO mercury_external_account_id;

-- Rename Modern Treasury fields in transactions
ALTER TABLE company_transactions RENAME COLUMN mt_payment_order_id TO mercury_payment_id;
ALTER TABLE company_transactions RENAME COLUMN mt_payment_status TO mercury_payment_status;

-- Rename Modern Treasury fields in payouts
ALTER TABLE worker_payouts RENAME COLUMN mt_payment_order_id TO mercury_payment_id;
ALTER TABLE worker_payouts RENAME COLUMN mt_payment_status TO mercury_payment_status;

-- Add Mercury-specific fields if needed
-- ALTER TABLE profiles ADD COLUMN mercury_account_id TEXT;
```

#### 3.2 Update Schema File

**File**: `shared/schema.ts`

```typescript
// Replace MT fields with Mercury equivalents
mercuryRecipientId: text("mercury_recipient_id"),
mercuryExternalAccountId: text("mercury_external_account_id"),
mercuryBankVerified: boolean("mercury_bank_verified").default(false),
// Remove: mtVirtualAccountId, mtLedgerAccountId
```

### Phase 4: Implement Mercury Service

**Status**: NOT STARTED

**File**: `server/services/mercury.ts` (to be created)

```typescript
import { log } from "../index";

interface MercuryConfig {
  apiToken: string;
  baseUrl: string;
}

function getMercuryConfig(): MercuryConfig {
  const isDev = process.env.NODE_ENV === "development";
  
  if (isDev) {
    return {
      apiToken: process.env.MERCURY_SANDBOX_API_TOKEN!,
      baseUrl: "https://sandbox.mercury.com/api/v1",
    };
  } else {
    return {
      apiToken: process.env.MERCURY_PRODUCTION_API_TOKEN!, // From GCP Secrets
      baseUrl: "https://api.mercury.com/v1",
    };
  }
}

export const mercuryService = {
  // Verify API token and connectivity
  async verifyConnection(): Promise<boolean> {
    try {
      const config = getMercuryConfig();
      const response = await fetch(`${config.baseUrl}/account`, {
        headers: {
          'Authorization': `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
      });
      return response.ok;
    } catch (error: any) {
      log(`Mercury connection failed: ${error.message}`, "mercury");
      return false;
    }
  },

  // Get account balance
  async getBalance(): Promise<number> {
    const config = getMercuryConfig();
    const response = await fetch(`${config.baseUrl}/account`, {
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
      },
    });
    const data = await response.json();
    return data.availableBalance; // In cents
  },

  // Create recipient (equivalent to counterparty)
  async createRecipient(params: {
    name: string;
    email?: string;
    type: 'individual' | 'business';
  }) {
    const config = getMercuryConfig();
    const response = await fetch(`${config.baseUrl}/recipients`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: params.name,
        email: params.email,
        type: params.type,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create recipient: ${error.message}`);
    }
    
    return response.json();
  },

  // Add bank account to recipient
  async addRecipientBankAccount(params: {
    recipientId: string;
    routingNumber: string;
    accountNumber: string;
    accountType: 'checking' | 'savings';
  }) {
    const config = getMercuryConfig();
    const response = await fetch(`${config.baseUrl}/recipients/${params.recipientId}/bank-accounts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        routingNumber: params.routingNumber,
        accountNumber: params.accountNumber,
        accountType: params.accountType,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to add bank account: ${error.message}`);
    }
    
    return response.json();
  },

  // Create ACH debit (pull money from company)
  async createDebit(params: {
    recipientId: string;
    amount: number; // In cents
    description: string;
    idempotencyKey?: string;
  }) {
    const config = getMercuryConfig();
    const response = await fetch(`${config.baseUrl}/debits`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey || crypto.randomUUID(),
      },
      body: JSON.stringify({
        recipientId: params.recipientId,
        amount: params.amount,
        description: params.description,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to create debit: ${error.message}`);
    }
    
    return response.json();
  },

  // Send ACH payment (pay worker)
  async sendPayment(params: {
    recipientId: string;
    amount: number; // In cents
    description: string;
    idempotencyKey?: string;
  }) {
    const config = getMercuryConfig();
    const response = await fetch(`${config.baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': params.idempotencyKey || crypto.randomUUID(),
      },
      body: JSON.stringify({
        recipientId: params.recipientId,
        amount: params.amount,
        description: params.description,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Failed to send payment: ${error.message}`);
    }
    
    return response.json();
  },

  // Get payment status
  async getPayment(paymentId: string) {
    const config = getMercuryConfig();
    const response = await fetch(`${config.baseUrl}/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Payment not found');
    }
    
    return response.json();
  },

  // List transactions
  async listTransactions(params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  }) {
    const config = getMercuryConfig();
    const queryParams = new URLSearchParams();
    if (params?.startDate) queryParams.set('startDate', params.startDate);
    if (params?.endDate) queryParams.set('endDate', params.endDate);
    if (params?.limit) queryParams.set('limit', params.limit.toString());
    
    const response = await fetch(`${config.baseUrl}/transactions?${queryParams}`, {
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
      },
    });
    
    return response.json();
  },
};

export default mercuryService;
```

### Phase 5: Update Auto-Replenishment

**Status**: NOT STARTED

**File**: `server/auto-replenishment-scheduler.ts`

Replace Modern Treasury calls with Mercury:

```typescript
// OLD: Modern Treasury
import { modernTreasuryService, getPlatformInternalAccountId } from "./services/modernTreasury";
const paymentOrder = await modernTreasuryService.createACHDebit({ ... });

// NEW: Mercury
import mercuryService from "./services/mercury";
const payment = await mercuryService.createDebit({
  recipientId: profile.mercuryRecipientId!,
  amount: company.shortfallCents,
  description: `Auto-replenishment: Commitments + $2,000 minimum`,
  idempotencyKey: `auto-replenish-${company.companyId}-${Date.now()}`,
});
```

### Phase 6: Update API Routes

**Status**: NOT STARTED

**File**: `server/routes.ts`

Replace all Modern Treasury imports and calls:

```typescript
// Remove
import { modernTreasuryService, getPlatformInternalAccountId } from "./services/modernTreasury";

// Add
import mercuryService from "./services/mercury";

// Update all payment processing endpoints
// Lines 6602-6648, etc.
```

### Phase 7: Frontend Updates

**Status**: NOT STARTED

**Files to Update**:
- `client/src/pages/worker/PayoutSettings.tsx` - Remove MT references
- `client/src/pages/CompanyOnboarding.tsx` - Update bank linking flow
- `client/src/pages/CompanyDashboard.tsx` - Update payment method display

**UI Changes**:
- Remove "Modern Treasury" branding
- Add "Mercury Bank" branding
- Update payment method icons
- Update status messages

### Phase 8: Testing

**Status**: NOT STARTED

**Test Scenarios**:

1. **Company Onboarding**
   - [ ] Link bank account (creates Mercury recipient)
   - [ ] Verify bank account
   - [ ] Display payment method correctly

2. **Auto-Replenishment**
   - [ ] Trigger auto-replenishment
   - [ ] Verify ACH debit created in Mercury
   - [ ] Confirm balance updated in database
   - [ ] Check transaction history

3. **Worker Payouts**
   - [ ] Create payout
   - [ ] Verify ACH credit created in Mercury
   - [ ] Check payment status
   - [ ] Confirm worker receives payment

4. **Timesheet Auto-Charging**
   - [ ] Auto-approve timesheet
   - [ ] Charge company via Mercury ACH
   - [ ] Verify invoice marked paid
   - [ ] Check transaction recorded

5. **Error Handling**
   - [ ] Test insufficient funds
   - [ ] Test invalid bank account
   - [ ] Test API errors
   - [ ] Verify user gets appropriate error messages

### Phase 9: Cleanup

**Status**: NOT STARTED

- [ ] Remove `server/services/modernTreasury.ts`
- [ ] Remove Modern Treasury imports from all files
- [ ] Uninstall `modern-treasury` npm package
- [ ] Remove Modern Treasury env vars from `.env.development`
- [ ] Delete Modern Treasury secrets from Google Cloud
- [ ] Update all documentation
- [ ] Remove Modern Treasury from `package.json`

---

## Database Schema Changes

### Fields to Rename

```sql
-- Profiles table
mt_counterparty_id → mercury_recipient_id
mt_external_account_id → mercury_external_account_id
mt_bank_verified → mercury_bank_verified
mt_virtual_account_id → (DELETE - not used by Mercury)
mt_ledger_account_id → (DELETE - not used by Mercury)

-- Company Payment Methods table
mt_counterparty_id → mercury_recipient_id
mt_external_account_id → mercury_external_account_id

-- Company Transactions table
mt_payment_order_id → mercury_payment_id
mt_payment_status → mercury_payment_status

-- Worker Payouts table
mt_payment_order_id → mercury_payment_id
mt_payment_status → mercury_payment_status
```

### Migration SQL Script

```sql
-- Create migration: 001_modern_treasury_to_mercury.sql

BEGIN;

-- Profiles table
ALTER TABLE profiles RENAME COLUMN mt_counterparty_id TO mercury_recipient_id;
ALTER TABLE profiles RENAME COLUMN mt_external_account_id TO mercury_external_account_id;
ALTER TABLE profiles RENAME COLUMN mt_bank_verified TO mercury_bank_verified;
ALTER TABLE profiles DROP COLUMN IF EXISTS mt_virtual_account_id;
ALTER TABLE profiles DROP COLUMN IF EXISTS mt_ledger_account_id;

-- Company Payment Methods table
ALTER TABLE company_payment_methods RENAME COLUMN mt_counterparty_id TO mercury_recipient_id;
ALTER TABLE company_payment_methods RENAME COLUMN mt_external_account_id TO mercury_external_account_id;

-- Company Transactions table
ALTER TABLE company_transactions RENAME COLUMN mt_payment_order_id TO mercury_payment_id;
ALTER TABLE company_transactions RENAME COLUMN mt_payment_status TO mercury_payment_status;

-- Worker Payouts table
ALTER TABLE worker_payouts RENAME COLUMN mt_payment_order_id TO mercury_payment_id;
ALTER TABLE worker_payouts RENAME COLUMN mt_payment_status TO mercury_payment_status;

COMMIT;
```

---

## Service Implementation Comparison

### Modern Treasury (Old)

```typescript
// Create counterparty
const counterparty = await modernTreasuryService.createCounterparty({
  name: "Acme Corp",
  email: "billing@acme.com",
  accounts: [{
    routingNumber: "123456789",
    accountNumber: "987654321",
    accountType: "checking"
  }]
});

// Create payment
const payment = await modernTreasuryService.createACHDebit({
  originatingAccountId: platformAccountId,
  counterpartyId: counterparty.id,
  receivingAccountId: externalAccount.id,
  amount: 10000, // $100.00
  description: "Top-up",
});
```

### Mercury (New)

```typescript
// Create recipient
const recipient = await mercuryService.createRecipient({
  name: "Acme Corp",
  email: "billing@acme.com",
  type: "business",
});

// Add bank account
const bankAccount = await mercuryService.addRecipientBankAccount({
  recipientId: recipient.id,
  routingNumber: "123456789",
  accountNumber: "987654321",
  accountType: "checking",
});

// Create debit
const payment = await mercuryService.createDebit({
  recipientId: recipient.id,
  amount: 10000, // $100.00
  description: "Top-up",
  idempotencyKey: `top-up-${Date.now()}`,
});
```

**Key Differences**:
- ✅ Simpler - fewer steps
- ✅ No need for platform internal account ID
- ✅ Direct debit/payment methods
- ✅ Built-in idempotency
- ✅ Clearer naming conventions

---

## Payment Status Mapping

| Modern Treasury Status | Mercury Status |
|-----------------------|----------------|
| `pending` | `pending` |
| `processing` | `processing` |
| `sent` | `sent` |
| `completed` | `completed` |
| `failed` | `failed` |
| `returned` | `returned` |

Mercury statuses are simpler and more intuitive.

---

## API Endpoints to Update

### 1. Company Payment Methods

**Endpoint**: `POST /api/company/payment-methods`

```typescript
// OLD: Modern Treasury
const counterparty = await modernTreasuryService.createCounterparty({ ... });
const externalAccount = await modernTreasuryService.createExternalAccount({ ... });

// NEW: Mercury
const recipient = await mercuryService.createRecipient({ ... });
const bankAccount = await mercuryService.addRecipientBankAccount({ ... });

await db.insert(companyPaymentMethods).values({
  profileId: profile.id,
  type: "ach",
  mercuryRecipientId: recipient.id,
  mercuryExternalAccountId: bankAccount.id,
  routingNumber: params.routingNumber,
  lastFour: params.accountNumber.slice(-4),
  bankName: params.bankName,
  isPrimary: true,
  isVerified: true,
});
```

### 2. Auto-Replenishment

**File**: `server/auto-replenishment-scheduler.ts`

```typescript
// OLD: Modern Treasury
const paymentOrder = await modernTreasuryService.createACHDebit({
  originatingAccountId: platformAccountId,
  counterpartyId: profile.mtCounterpartyId!,
  receivingAccountId: profile.mtExternalAccountId!,
  amount: shortfallCents,
  description: `Auto-replenishment`,
});

// NEW: Mercury
const payment = await mercuryService.createDebit({
  recipientId: profile.mercuryRecipientId!,
  amount: shortfallCents,
  description: `Auto-replenishment: Commitments + $2,000 minimum`,
  idempotencyKey: `auto-replenish-${profile.id}-${Date.now()}`,
});

await db.insert(companyTransactions).values({
  profileId: profile.id,
  type: "auto_recharge",
  amount: shortfallCents,
  mercuryPaymentId: payment.id,
  mercuryPaymentStatus: payment.status,
  paymentMethod: "ach",
});
```

### 3. Worker Payouts

**Endpoint**: `POST /api/worker/payouts`

```typescript
// NEW: Mercury
const payment = await mercuryService.sendPayment({
  recipientId: worker.mercuryRecipientId!,
  amount: payoutAmount,
  description: `Payout for Job #${jobId}`,
  idempotencyKey: `payout-${workerId}-${timesheetId}`,
});

await db.insert(workerPayouts).values({
  workerId: workerId,
  jobId: jobId,
  timesheetId: timesheetId,
  amount: payoutAmount,
  status: payment.status,
  mercuryPaymentId: payment.id,
  mercuryPaymentStatus: payment.status,
});
```

### 4. Timesheet Auto-Charging

**Endpoint**: `POST /api/timesheets/process-auto-approvals`

```typescript
// Lines 6602-6648 in routes.ts
// Replace Modern Treasury ACH charging with Mercury

if (paymentMethod.type === "ach" && paymentMethod.mercuryRecipientId) {
  const payment = await mercuryService.createDebit({
    recipientId: paymentMethod.mercuryRecipientId,
    amount: totalAmount,
    description: `Auto-approved Timesheet #${ts.id}`,
    idempotencyKey: `timesheet-${ts.id}-${Date.now()}`,
  });

  await db.insert(companyTransactions).values({
    profileId: company.id,
    type: "charge",
    amount: totalAmount,
    description: `Auto-approved Timesheet #${ts.id}`,
    paymentMethod: "ach",
    mercuryPaymentId: payment.id,
    mercuryPaymentStatus: payment.status,
  });
}
```

---

## Webhooks

### Modern Treasury Webhooks (Remove)
- Payment order status updates
- Counterparty updates
- External account verification

### Mercury Webhooks (Add)
```typescript
app.post("/api/webhooks/mercury", async (req, res) => {
  const signature = req.headers['mercury-signature'] as string;
  const payload = JSON.stringify(req.body);
  
  // Verify signature
  const isValid = await mercuryService.verifyWebhookSignature(payload, signature);
  if (!isValid) {
    return res.status(401).json({ message: "Invalid signature" });
  }
  
  const event = req.body;
  
  switch (event.type) {
    case 'payment.completed':
      // Handle payment completion
      await handlePaymentCompleted(event.data);
      break;
    case 'payment.failed':
      // Handle payment failure
      await handlePaymentFailed(event.data);
      break;
    case 'debit.completed':
      // Handle debit completion
      await handleDebitCompleted(event.data);
      break;
    // ... other events
  }
  
  res.json({ received: true });
});
```

---

## Error Handling

### Mercury Error Types

```typescript
type MercuryError = {
  code: string;
  message: string;
  details?: any;
};

// Common errors:
// - insufficient_funds
// - invalid_account
// - invalid_routing_number
// - recipient_not_found
// - duplicate_payment (use idempotency keys)
// - rate_limit_exceeded
```

### Error Handling Pattern

```typescript
try {
  const payment = await mercuryService.sendPayment({ ... });
} catch (error: any) {
  if (error.code === 'insufficient_funds') {
    // Handle insufficient funds
    await handleInsufficientFunds(companyId);
  } else if (error.code === 'invalid_account') {
    // Handle invalid account
    await notifyCompanyOfInvalidAccount(companyId);
  } else {
    // Generic error handling
    log(`Mercury payment failed: ${error.message}`, "mercury");
    throw error;
  }
}
```

---

## Timeline

### Estimated Timeline

| Phase | Duration | Start Date | End Date |
|-------|----------|------------|----------|
| Phase 1: Archive | 1 hour | ✅ Complete | ✅ Complete |
| Phase 2: Token Setup | 30 min | Jan 27 | Jan 27 |
| Phase 3: Database Migration | 1 hour | Jan 27 | Jan 27 |
| Phase 4: Mercury Service | 4 hours | Jan 27 | Jan 28 |
| Phase 5: Auto-Replenishment | 2 hours | Jan 28 | Jan 28 |
| Phase 6: API Routes | 3 hours | Jan 28 | Jan 28 |
| Phase 7: Frontend Updates | 2 hours | Jan 28 | Jan 28 |
| Phase 8: Testing | 4 hours | Jan 28 | Jan 29 |
| Phase 9: Cleanup | 1 hour | Jan 29 | Jan 29 |
| **Total** | **~18 hours** | | |

---

## Rollback Plan

If Mercury integration fails:

1. **Restore Modern Treasury service**:
   ```bash
   cp archived/modernTreasury.service.ts server/services/modernTreasury.ts
   ```

2. **Rollback database changes**:
   ```sql
   -- Revert column renames
   ALTER TABLE profiles RENAME COLUMN mercury_recipient_id TO mt_counterparty_id;
   -- ... etc
   ```

3. **Restore environment variables**:
   - Re-enable Modern Treasury secrets in GCP
   - Add to `.env.development`

4. **Reinstall dependency**:
   ```bash
   npm install modern-treasury
   ```

5. **Revert code changes** via Git:
   ```bash
   git checkout -- server/routes.ts server/auto-replenishment-scheduler.ts
   ```

---

## Success Criteria

Migration is successful when:

✅ All company bank accounts work with Mercury  
✅ Auto-replenishment charges via Mercury ACH  
✅ Worker payouts process via Mercury ACH  
✅ Timesheet auto-charging uses Mercury  
✅ Transaction history displays correctly  
✅ No Modern Treasury code remains  
✅ No Modern Treasury dependencies  
✅ All tests pass  
✅ Production deployment successful  

---

## Resources

### Mercury Bank
- **API Docs**: https://docs.mercury.com/
- **API Reference**: https://docs.mercury.com/reference
- **Sandbox**: https://sandbox.mercury.com/
- **Support**: api-support@mercury.com

### Internal Documentation
- **Archive**: `ARCHIVED_MODERN_TREASURY_INTEGRATION.md`
- **Tokens**: `MERCURY_API_TOKENS.md`
- **This Plan**: `MERCURY_BANK_MIGRATION.md`

### Team Contacts
- **Lead Developer**: Implementation owner
- **DevOps**: Production deployment
- **QA**: Testing coordination

---

## Next Immediate Steps

1. **Add sandbox token to `.env.development`**:
   ```env
   MERCURY_SANDBOX_API_TOKEN=<your-mercury-sandbox-token>
   ```

2. **Create Mercury service** (`server/services/mercury.ts`)

3. **Run database migration** script

4. **Test Mercury API connectivity** with sandbox token

5. **Update one endpoint** at a time (start with company payment methods)

6. **Test thoroughly** before moving to next endpoint

---

**Migration Owner**: Development Team  
**Priority**: High  
**Status**: Phase 1 Complete, Phase 2 In Progress  
**Last Updated**: January 27, 2026

# ARCHIVED: Modern Treasury Integration

**Archive Date**: January 27, 2026  
**Status**: REPLACED BY MERCURY BANK  
**Reason**: Migrating to Mercury Bank for all payment processing flows  

This document archives the complete Modern Treasury integration for future reference.

---

## Table of Contents

1. [Service File](#service-file)
2. [Database Schema](#database-schema)
3. [API Routes](#api-routes)
4. [Auto-Replenishment Scheduler](#auto-replenishment-scheduler)
5. [Environment Variables](#environment-variables)
6. [Dependencies](#dependencies)
7. [Documentation Files](#documentation-files)

---

## Service File

### `server/services/modernTreasury.ts` (617 lines)

**Full service implementation archived in**: `archived/modernTreasury.service.ts`

**Key Features**:
- Counterparty management (companies & workers)
- External account creation and linking
- ACH debits (pulling money from companies)
- ACH credits (paying workers)
- Virtual accounts (company prepaid balances)
- Ledger accounts (balance tracking)
- Payment order creation and tracking
- Webhook signature verification
- High-level business operations:
  - `fundCompanyBalance()` - Pull funds from company bank
  - `processWorkerPayout()` - Pay workers via ACH
  - `handleInsufficientBalance()` - Handle shortfalls

**API Credentials**:
```typescript
// Development (Sandbox)
MODERN_TREASURY_SANDBOX_API_KEY
MODERN_TREASURY_SANDBOX_ORG_ID

// Production (Live)
MODERN_TREASURY_API_KEY
MODERN_TREASURY_ORG_ID

// Platform account
MT_PLATFORM_INTERNAL_ACCOUNT_ID
```

---

## Database Schema

### Profile Fields (Modern Treasury)

```typescript
// Modern Treasury payment platform fields
mtCounterpartyId: text("mt_counterparty_id"),
mtExternalAccountId: text("mt_external_account_id"),
mtBankVerified: boolean("mt_bank_verified").default(false),
mtVirtualAccountId: text("mt_virtual_account_id"), // Company prepaid balance account
mtLedgerAccountId: text("mt_ledger_account_id"), // Company balance ledger account
```

### Company Payment Methods Table

```typescript
export const companyPaymentMethods = pgTable("company_payment_methods", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  type: text("type", { enum: ["ach", "card"] }).notNull().default("ach"),
  lastFour: text("last_four").notNull(),
  bankName: text("bank_name"),
  
  // Modern Treasury fields
  mtCounterpartyId: text("mt_counterparty_id"),
  mtExternalAccountId: text("mt_external_account_id"),
  routingNumber: text("routing_number"),
  accountNumber: text("account_number"),
  isPrimary: boolean("is_primary").default(false),
  isVerified: boolean("is_verified").default(false),
  locationIds: text("location_ids").array(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### Company Transactions Table

```typescript
export const companyTransactions = pgTable("company_transactions", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull(),
  type: text("type").notNull(), // "deposit", "withdrawal", "refund", etc.
  amount: integer("amount").notNull(), // In cents
  description: text("description"),
  
  // Modern Treasury payment tracking
  mtPaymentOrderId: text("mt_payment_order_id"),
  mtPaymentStatus: text("mt_payment_status"),
  
  paymentMethod: text("payment_method", { enum: ["ach", "card"] }),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### Worker Payouts Table

```typescript
export const workerPayouts = pgTable("worker_payouts", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("pending"),
  
  // Modern Treasury payment tracking
  mtPaymentOrderId: text("mt_payment_order_id"),
  mtPaymentStatus: text("mt_payment_status"),
  
  description: text("description"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});
```

---

## API Routes

### Modern Treasury Usage in `server/routes.ts`

#### 1. Auto-Replenishment (ACH Debits)
```typescript
// Line 4 import
import { modernTreasuryService, getPlatformInternalAccountId } from "./services/modernTreasury";

// Line 196 - ACH debit for company funding
const paymentOrder = await modernTreasuryService.createACHDebit({
  originatingAccountId: platformAccountId,
  counterpartyId: profile.mtCounterpartyId!,
  receivingAccountId: profile.mtExternalAccountId!,
  amount: company.shortfallCents,
  description: `Auto-replenishment: Commitments + $2,000 minimum`,
  metadata: {
    companyId: profile.id.toString(),
    type: "auto_recharge",
  },
});
```

#### 2. Auto-Approval Timesheet Charging (ACH)
```typescript
// Lines 6602-6648 - Charge location's ACH payment method
const mtModule = await import("./services/modernTreasury");
const modernTreasuryService = mtModule.default;
const platformAccountId = await getPlatformInternalAccountId();

const paymentOrder = await modernTreasuryService.createACHDebit({
  originatingAccountId: platformAccountId,
  counterpartyId: paymentMethod.mtCounterpartyId,
  receivingAccountId: paymentMethod.mtExternalAccountId,
  amount: totalAmount,
  description: `Auto-approved Timesheet #${ts.id} - ${location.name}`,
  metadata: {
    companyId: company.id.toString(),
    timesheetId: ts.id.toString(),
    type: "auto_approval_charge",
  },
});
```

#### 3. Worker Payout Routes (if implemented)
- ACH credits for paying workers
- Payment order status tracking
- Webhook handlers for payment status updates

---

## Auto-Replenishment Scheduler

### `server/auto-replenishment-scheduler.ts` (413 lines)

**Full file archived in**: `archived/auto-replenishment-scheduler.ts`

**Key Functions**:

```typescript
// Calculate company job commitments
async function calculateJobCommitments(companyId: number): Promise<number>

// Calculate pending payments
async function calculatePendingPayments(companyId: number): Promise<number>

// Find companies needing replenishment
async function getCompaniesNeedingReplenishment(): Promise<CompanyCommitments[]>

// Process replenishment (ACH debit via Modern Treasury)
async function processAutoReplenishment(company: CompanyCommitments): Promise<boolean>

// Start scheduler (runs every 5 minutes)
export function startAutoReplenishmentScheduler(): void

// Manual trigger for specific company
export async function triggerAutoReplenishmentForCompany(companyId: number): Promise<boolean>
```

**Logic**:
1. Check all companies with payment methods
2. Calculate: current balance, pending payments, job commitments
3. If shortfall exists: `shortfall = (pending + commitments + $2000 minimum) - current`
4. Create ACH debit via Modern Treasury (or charge card as fallback)
5. Update company balance in database
6. Log transaction

---

## Environment Variables

### Development (Sandbox)
```env
MODERN_TREASURY_SANDBOX_API_KEY=test_xxxxxxxxxxxxx
MODERN_TREASURY_SANDBOX_ORG_ID=your-sandbox-org-id
MT_PLATFORM_INTERNAL_ACCOUNT_ID=your-sandbox-internal-account-id
```

### Production (Live)
```env
MODERN_TREASURY_API_KEY=live_xxxxxxxxxxxxx
MODERN_TREASURY_ORG_ID=your-production-org-id
MT_PLATFORM_INTERNAL_ACCOUNT_ID=your-production-internal-account-id
```

### Google Cloud Secrets Manager
- `MODERN_TREASURY_API_KEY` (production)
- `MODERN_TREASURY_ORG_ID` (production)

---

## Dependencies

### NPM Package
```json
{
  "dependencies": {
    "modern-treasury": "^2.x.x"
  }
}
```

**Remove after migration**:
```bash
npm uninstall modern-treasury
```

---

## Documentation Files

### Archived Documentation (in `attached_assets/`)

1. **`Pasted-Below-is-a-clean-implementation-ready-mapping-of-Modern_1768326504641.txt`**
   - Implementation guide for Modern Treasury integration
   - API mappings and workflows

2. **`Pasted-Here-s-how-Modern-Treasury-actually-works-with-ACH-debi_1768332590919.txt`**
   - Detailed explanation of ACH debits/credits
   - Payment flow diagrams
   - Counterparty setup

3. **`Pasted-In-Modern-Treasury-Sandbox-you-can-realistically-test-p_1768699810959.txt`**
   - Sandbox testing guide
   - Test account setup
   - Payment simulation

### Referenced in Main Documentation

- `GCP_SECRETS_MANAGER_SETUP.md` - Modern Treasury credentials storage
- `QUICK_GCP_SETUP.md` - Mentions Modern Treasury setup
- `SECRETS_MIGRATION_COMPLETE.md` - Modern Treasury secrets migration
- `ENV_UPDATE_REQUIRED.md` - Modern Treasury env vars
- `DEPENDENCY_AUDIT.md` - Modern Treasury dependency notes
- `DEVELOPMENT_SETUP.md` - Modern Treasury setup instructions
- `MIGRATION_GUIDE.md` - Modern Treasury migration notes

---

## Key Concepts

### Counterparties
- External entities (companies or workers) that you transact with
- Each company/worker has ONE counterparty in Modern Treasury
- Stored as `mtCounterpartyId` in profiles table

### External Accounts
- Bank accounts belonging to counterparties
- Routing number + account number
- Used for ACH debits (companies) and credits (workers)
- Stored as `mtExternalAccountId`

### Internal Accounts
- Your platform's bank accounts in Modern Treasury
- Where money flows through
- Platform internal account ID used as originating account

### Payment Orders
- ACH debit: Pull money FROM counterparty TO platform
- ACH credit: Send money FROM platform TO counterparty
- Statuses: pending → processing → sent → completed
- Tracked as `mtPaymentOrderId` + `mtPaymentStatus`

### Virtual Accounts
- Virtual sub-accounts for each company
- Track prepaid balances
- Ledger-based accounting

### Ledger Accounts
- Double-entry bookkeeping
- Track balances, revenues, payables
- Separate from actual money movement

---

## Payment Flows (Archived)

### 1. Company Top-Up Flow
```
Company Bank Account (External)
  ↓ ACH Debit
Platform Bank Account (Internal)
  ↓ Ledger Credit
Company Virtual Balance (Ledger)
```

### 2. Worker Payout Flow
```
Company Virtual Balance (Ledger)
  ↓ Ledger Debit
Platform Bank Account (Internal)
  ↓ ACH Credit
Worker Bank Account (External)
```

### 3. Auto-Replenishment Flow
```
Scheduler detects low balance
  ↓
Calculate shortfall
  ↓
Create ACH debit (Modern Treasury)
  ↓
Pull funds from company bank
  ↓
Credit company virtual balance
  ↓
Update depositAmount in database
```

---

## API Endpoints Using Modern Treasury

### Company Payment Methods
- `POST /api/company/payment-methods` - Link bank account (creates counterparty + external account)
- `GET /api/company/payment-methods` - List linked payment methods
- `DELETE /api/company/payment-methods/:id` - Remove payment method

### Transactions
- `POST /api/company/transactions` - Manual top-up
- `GET /api/company/transactions` - Transaction history
- Transactions include `mtPaymentOrderId` and `mtPaymentStatus`

### Auto-Approval
- `POST /api/timesheets/process-auto-approvals` - Charges via ACH if available
- Falls back to card if ACH fails
- Uses Modern Treasury for ACH payments

### Webhooks (if implemented)
- `POST /api/webhooks/modern-treasury` - Payment status updates
- `POST /api/webhooks/mt-counterparty` - Counterparty updates

---

## Testing in Sandbox

### Sandbox Features
- Simulate ACH payment flows
- Test counterparty creation
- Test payment order creation
- View payment statuses
- Sandbox URL: https://app.moderntreasury.com/

### Sandbox Limitations
- No real money movement
- Simulated processing times
- May not reflect all production edge cases
- Instant settlement (vs 2-3 days in production)

---

## Migration Notes to Mercury

### Fields to Replace

| Modern Treasury | Mercury Equivalent |
|----------------|-------------------|
| `mtCounterpartyId` | `mercuryRecipientId` |
| `mtExternalAccountId` | `mercuryExternalAccountId` |
| `mtPaymentOrderId` | `mercuryPaymentId` |
| `mtPaymentStatus` | `mercuryPaymentStatus` |
| `mtVirtualAccountId` | *(Mercury doesn't use virtual accounts)* |
| `mtLedgerAccountId` | *(Handle with internal ledger)* |
| `mtBankVerified` | `mercuryBankVerified` |

### Services to Replace

| Modern Treasury Service | Mercury Equivalent |
|------------------------|-------------------|
| `createCounterparty()` | `createRecipient()` |
| `createExternalAccount()` | `addRecipientBankAccount()` |
| `createPaymentOrder()` | `createPayment()` |
| `createACHDebit()` | `initiateDebit()` |
| `createACHCredit()` | `sendPayment()` |

### Auto-Replenishment Replacement

Mercury likely uses:
- Direct debit authorization
- Bank account tokenization
- Payment scheduling
- Real-time balance tracking

Consult Mercury API documentation for exact implementation.

---

## Code to Archive (Move to `archived/` folder)

1. **`server/services/modernTreasury.ts`** → `archived/modernTreasury.service.ts`
2. **Update imports in**:
   - `server/routes.ts` (remove MT imports)
   - `server/auto-replenishment-scheduler.ts` (replace with Mercury)

3. **Database migrations** (create migration to rename fields):
   ```sql
   ALTER TABLE profiles RENAME COLUMN mt_counterparty_id TO mercury_recipient_id;
   ALTER TABLE profiles RENAME COLUMN mt_external_account_id TO mercury_external_account_id;
   -- etc.
   ```

4. **Update schema** (`shared/schema.ts`):
   - Replace MT field names with Mercury equivalents
   - Update comments

---

## Dependencies to Remove

```bash
npm uninstall modern-treasury
```

**package.json** - Remove this line:
```json
"modern-treasury": "^2.x.x"
```

---

## Environment Variables to Remove

### From `.env.development`:
```
MODERN_TREASURY_SANDBOX_API_KEY=...
MODERN_TREASURY_SANDBOX_ORG_ID=...
MT_PLATFORM_INTERNAL_ACCOUNT_ID=...
```

### From Google Cloud Secrets Manager:
- `MODERN_TREASURY_API_KEY`
- `MODERN_TREASURY_ORG_ID`

### Add Mercury Equivalents:
```
MERCURY_SANDBOX_API_KEY=...
MERCURY_PRODUCTION_API_KEY=... (from Google Secrets Manager)
```

---

## Migration Checklist

### Phase 1: Archive & Setup
- [x] Archive Modern Treasury service code
- [ ] Save Mercury API tokens
  - [x] Production token to Google Secrets Manager
  - [ ] Sandbox token to `.env.development`
- [ ] Review Mercury API documentation
- [ ] Create Mercury service implementation

### Phase 2: Database Migration
- [ ] Create database migration script
- [ ] Rename MT columns to Mercury equivalents
- [ ] Update schema.ts
- [ ] Test database changes

### Phase 3: Code Migration
- [ ] Implement Mercury service (`server/services/mercury.ts`)
- [ ] Update auto-replenishment scheduler
- [ ] Update API routes in `routes.ts`
- [ ] Replace all Modern Treasury calls
- [ ] Remove Modern Treasury imports

### Phase 4: Frontend Updates
- [ ] Update PayoutSettings.tsx
- [ ] Update CompanyOnboarding.tsx
- [ ] Update CompanyDashboard.tsx
- [ ] Update any UI showing payment method details

### Phase 5: Testing
- [ ] Test company payment method linking
- [ ] Test auto-replenishment
- [ ] Test worker payouts
- [ ] Test timesheet auto-charging
- [ ] Test transaction history

### Phase 6: Cleanup
- [ ] Remove `server/services/modernTreasury.ts`
- [ ] Remove Modern Treasury dependencies
- [ ] Remove Modern Treasury env vars
- [ ] Update all documentation
- [ ] Deploy to production

---

## Support Resources (Archived)

### Modern Treasury Documentation
- **API Docs**: https://docs.moderntreasury.com/
- **Sandbox**: https://app.moderntreasury.com/
- **Support**: support@moderntreasury.com

### Key Concepts Documentation
- **Payment Orders**: https://docs.moderntreasury.com/docs/payment-orders
- **Counterparties**: https://docs.moderntreasury.com/docs/counterparties
- **Virtual Accounts**: https://docs.moderntreasury.com/docs/virtual-accounts
- **Ledgers**: https://docs.moderntreasury.com/docs/ledgers

---

## Contact Information (Archived)

**Modern Treasury Account**:
- Organization ID: *(stored in environment)*
- Support Email: support@moderntreasury.com
- Account Rep: *(if applicable)*

---

## End of Archive

This integration served the platform well. All functionality will be replicated and improved with Mercury Bank.

**Next Steps**: See `MERCURY_BANK_MIGRATION.md` for implementation plan.

---

**Archive Maintained By**: Tolstoy Staffing Development Team  
**Last Updated**: January 27, 2026  
**Status**: Complete archive, ready for Mercury migration

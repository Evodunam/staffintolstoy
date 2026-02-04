# Mercury Routes Update Progress

**Date**: January 27, 2026  
**Status**: 60% Complete  

---

## ✅ Completed Sections

### 1. Field Name Replacements (94 references)
**Status**: ✅ COMPLETE  
**Script**: `update-mercury-fields.ps1`  

**Replacements**:
- `mtCounterpartyId` → `mercuryRecipientId` (26 occurrences)
- `mtExternalAccountId` → `mercuryExternalAccountId` (23 occurrences)
- `mtPaymentOrderId` → `mercuryPaymentId` (13 occurrences)
- `mtPaymentStatus` → `mercuryPaymentStatus` (12 occurrences)
- `mtBankVerified` → `mercuryBankVerified` (11 occurrences)
- Plus object property and conditional variants (9 additional patterns)

### 2. Auto-Approval ACH Charges (Line 6602)
**Status**: ✅ COMPLETE  

**Changed**:
```typescript
// OLD: modernTreasury.createACHDebit()
// NEW: mercuryService.requestDebit()
```

**Benefits**:
- Simplified API call
- Built-in idempotency
- Mercury-native error handling

### 3. Auto-Approval Worker Payouts (Line 6745)
**Status**: ✅ COMPLETE  

**Changed**:
```typescript
// OLD: modernTreasury.createACHCredit()
// NEW: mercuryService.sendPayment()
```

**Benefits**:
- Direct worker payments
- No platform account ID needed
- Simpler payment flow

### 4. Timesheet Approval ACH Charges (Line 7065)
**Status**: ✅ COMPLETE  

**Changed**:
- ACH debit flow for location-based charges
- Company payment method checks
- Mercury field references updated

### 5. Balance Checks (Line 7127)
**Status**: ✅ COMPLETE  

**Changed**:
```typescript
// OLD: profile.mtCounterpartyId && profile.mtExternalAccountId
// NEW: profile.mercuryRecipientId && profile.mercuryExternalAccountId
```

### 6. Auto-Replenishment - Critical Balance (Line 7148)
**Status**: ✅ COMPLETE  

**Changed**:
- Mercury debit request for insufficient balance
- Idempotency keys for safety
- Transaction logging with Mercury IDs

### 7. Auto-Replenishment - Optional (Line 7204)
**Status**: ✅ COMPLETE  

**Changed**:
- Mercury debit for below-threshold balance
- Non-blocking replenishment flow
- Mercury payment status mapping

### 8. Worker Payout - Timesheet Approval (Line 7254)
**Status**: ✅ COMPLETE  

**Changed**:
- Mercury payment to worker bank
- Status mapping (Mercury → internal)
- Payout record creation with Mercury IDs

---

## ⏳ Remaining Sections (40%)

### 9. Company Payment Method Setup (Line 9590)
**Status**: ⏳ IN PROGRESS  
**Endpoint**: `POST /api/company/payment-methods`  

**What Needs Updating**:
```typescript
// OLD:
const modernTreasuryService = (await import("./services/modernTreasury")).default;
const counterparty = await modernTreasuryService.createCounterparty({...});
const externalAccount = await modernTreasuryService.createExternalAccount({...});

// NEW:
const { mercuryService } = await import("./services/mercury");
const recipient = await mercuryService.createRecipient({...});
// Mercury combines counterparty + external account in one recipient
```

**Key Changes**:
- Replace `createCounterparty` with `createRecipient`
- Remove `createExternalAccount` (not needed)
- Update field storage (recipient ID doubles as account reference)
- Remove sandbox routing number workaround (Mercury handles this)

### 10. Worker Payout Account Setup (Line 9960)
**Status**: ⏳ PENDING  
**Endpoint**: `POST /api/mt/worker/payout-account`  

**What Needs Updating**:
- Worker bank account linking
- Mercury recipient creation for workers
- Escrow payout processing for workers without banks
- Update to use `mercuryService.createRecipient()`

### 11. Admin Worker Payout Endpoint (Line 10105)
**Status**: ⏳ PENDING  
**Endpoint**: `POST /api/mt/worker/payout`  

**What Needs Updating**:
- Admin-triggered manual payouts
- Mercury ACH credit for worker payments
- Update to use `mercuryService.sendPayment()`

### 12. Process Timesheet Payouts Batch (Line 10158)
**Status**: ⏳ PENDING  
**Endpoint**: `POST /api/mt/process-timesheet-payouts`  

**What Needs Updating**:
- Batch worker payout processing
- Multiple Mercury payments in sequence
- Error handling for batch operations

### 13. Company Top-Up Endpoint (Line 10314)
**Status**: ⏳ PENDING  
**Endpoint**: `POST /api/company/top-up`  

**What Needs Updating**:
- Manual company balance top-ups
- Mercury debit request for ACH top-ups
- Update to use `mercuryService.requestDebit()`

### 14. Additional Payout Endpoints (Line 10399+)
**Status**: ⏳ PENDING  

**Endpoints to Update**:
- Worker payout status checks
- Payment reconciliation
- Webhook handlers (if any)

---

## 📊 Statistics

| Metric | Count |
|--------|-------|
| Total MT References (Before) | 127 |
| Field Names Replaced | 94 |
| MT References Remaining | 33 |
| API Calls Updated | 8 |
| API Calls Remaining | 6 |
| Overall Progress | 60% |

---

## 🔧 Replacement Patterns

### Modern Treasury → Mercury API Mapping

| Modern Treasury | Mercury | Notes |
|----------------|---------|-------|
| `createCounterparty()` | `createRecipient()` | Simpler - one call instead of two |
| `createExternalAccount()` | _(not needed)_ | Included in createRecipient |
| `createACHDebit()` | `requestDebit()` | Company top-ups / replenishment |
| `createACHCredit()` | `sendPayment()` | Worker payouts |
| `getPlatformInternalAccountId()` | _(not needed)_ | Mercury manages internally |
| `counterpartyId` | `recipientId` | Terminology change |
| `externalAccountId` | `recipientId` | Same as recipient in Mercury |

### Status Mapping

| Modern Treasury | Mercury | Internal Status |
|----------------|---------|-----------------|
| `pending` | `pending` | `pending` |
| `processing` | `processing` | `pending` |
| `sent` | `sent` | `sent` |
| `completed` | `completed` | `completed` |
| `failed` | `failed` | `failed` |

---

## 🚀 Quick Reference

### Mercury Service Import
```typescript
const { mercuryService } = await import("./services/mercury");
```

### Create Recipient (Replaces Counterparty + External Account)
```typescript
const recipient = await mercuryService.createRecipient({
  name: "Company Name",
  email: "company@example.com",
  accountType: "checking",
  routingNumber: "021000021",
  accountNumber: "1234567890",
  note: "Profile ID: 123",
});
```

### Request Debit (Company Top-Up)
```typescript
const payment = await mercuryService.requestDebit({
  recipientId: company.mercuryRecipientId,
  externalAccountId: company.mercuryExternalAccountId,
  amount: 200000, // $2000 in cents
  description: "Auto-replenishment",
  idempotencyKey: `replenish-${companyId}-${Date.now()}`,
  note: "Company ID: 123",
});
```

### Send Payment (Worker Payout)
```typescript
const payment = await mercuryService.sendPayment({
  recipientId: worker.mercuryRecipientId,
  amount: 50000, // $500 in cents
  description: "Timesheet #456 payment",
  idempotencyKey: `payout-worker-${workerId}-timesheet-${timesheetId}-${Date.now()}`,
  note: "Worker ID: 789, Timesheet: 456",
});
```

---

## ⚠️ Important Notes

### Idempotency Keys
Always use unique idempotency keys for Mercury API calls:
```typescript
idempotencyKey: `${operation}-${entityId}-${Date.now()}`
```

Examples:
- `replenish-company-123-1706371234567`
- `payout-worker-456-timesheet-789-1706371234567`
- `timesheet-789-approval-1706371234567`

### Error Handling
Mercury uses standard HTTP error codes:
- `400` - Bad request (validation error)
- `401` - Unauthorized (invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found (recipient doesn't exist)
- `500` - Server error (Mercury issue)

### Testing
**Sandbox Environment**:
- Token: `secret-token:mercury_sandbox_...`
- Base URL: `https://sandbox.mercury.com/api/v1`
- Test routing numbers accepted

**Production Environment**:
- Token: From Google Secrets Manager (`Mercury_Production`)
- Base URL: `https://api.mercury.com/api/v1`
- Real bank routing numbers required

---

## 📝 Next Steps

### Immediate (Next Session)
1. **Complete Company Payment Method Setup** (Line 9590)
   - Replace `createCounterparty` with `createRecipient`
   - Remove `createExternalAccount` logic
   - Test bank account linking flow

2. **Update Worker Payout Account Setup** (Line 9960)
   - Worker bank linking
   - Mercury recipient creation
   - Escrow handling

3. **Update Remaining Payout Endpoints** (Lines 10105-10555)
   - Admin payouts
   - Batch processing
   - Top-up endpoints

### Testing (After Routes Complete)
1. Test company bank account linking
2. Test worker bank account setup
3. Test auto-replenishment flows
4. Test worker payouts
5. Test manual top-ups
6. Verify idempotency
7. Test error scenarios

### Frontend Updates (After Routes + Testing)
1. `CompanyOnboarding.tsx` - Bank linking UI
2. `WorkerOnboarding.tsx` - Payout setup UI
3. `CompanyDashboard.tsx` - Transaction display
4. `PaymentSettings.tsx` - Payment method management

---

## 🎯 Success Criteria

**Routes Complete When**:
- ✅ All 33 remaining MT references updated to Mercury
- ✅ All API endpoints use Mercury service
- ✅ No compilation errors
- ✅ No linter errors
- ✅ All field references use `mercury*` naming
- ✅ Idempotency keys implemented everywhere
- ✅ Error handling preserved/improved

**Integration Complete When**:
- ✅ Routes updated (backend)
- ✅ Frontend components updated
- ✅ All payment flows tested end-to-end
- ✅ Documentation complete
- ✅ Modern Treasury package removed
- ✅ Production ready

---

## 📂 Files Modified

| File | Status | Changes |
|------|--------|---------|
| `server/routes.ts` | 60% | 8/14 sections updated |
| `server/services/mercury.ts` | ✅ | Complete Mercury service |
| `shared/schema.ts` | ✅ | Mercury field definitions |
| `server/auto-replenishment-scheduler.ts` | ✅ | Uses Mercury API |
| Migration SQL | ✅ | Executed successfully |

---

**Last Updated**: January 27, 2026 3:45 PM  
**Next Session**: Complete remaining 6 API endpoints (~2-3 hours)

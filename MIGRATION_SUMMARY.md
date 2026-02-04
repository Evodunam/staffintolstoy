# Modern Treasury → Mercury Bank Migration Summary

**Migration Date**: January 27, 2026  
**Status**: Phase 1 Complete ✅ | Phase 2 Ready  

---

## ✅ What's Been Completed

### 1. Modern Treasury Integration Archived

**Archived Files**:
- ✅ `archived/modernTreasury.service.ts` (617 lines)
- ✅ `archived/auto-replenishment-scheduler.ts` (413 lines)
- ✅ `archived/README.md` (documentation)

**Documentation Created**:
- ✅ `ARCHIVED_MODERN_TREASURY_INTEGRATION.md` - Complete integration archive
- ✅ `MERCURY_BANK_MIGRATION.md` - Detailed migration plan
- ✅ `MERCURY_API_TOKENS.md` - Token storage & access guide
- ✅ `MERCURY_GOOGLE_SECRETS_SETUP.md` - GCP secrets configuration
- ✅ `ADD_TO_ENV_DEVELOPMENT.md` - Quick setup instructions

### 2. Mercury API Tokens Configured

**Production Token** ✅:
- **Name**: `Mercury_Production`
- **Storage**: Google Cloud Secrets Manager
- **Token**: `<stored in GCP — do not commit>`
- **Status**: Stored and ready

**Sandbox Token** 📝:
- **Name**: `Mercury_Sandbox`
- **Storage**: `.env.development` (local)
- **Token**: `<add to .env.development — do not commit>`
- **Status**: Ready to add

---

## 📋 Next Steps (Action Required)

### IMMEDIATE: Add Sandbox Token

**Add this line to `.env.development`**:

```env
# Mercury Bank API - Sandbox
MERCURY_SANDBOX_API_TOKEN=<your-mercury-sandbox-token>
```

Then restart your dev server:
```bash
npm run dev
```

### Phase 2: Implement Mercury Service

**Create**: `server/services/mercury.ts`

**Key Functions to Implement**:
```typescript
mercuryService.createRecipient()          // Replace createCounterparty()
mercuryService.addRecipientBankAccount()  // Replace createExternalAccount()
mercuryService.createDebit()              // Replace createACHDebit()
mercuryService.sendPayment()              // Replace createACHCredit()
mercuryService.getPayment()               // Replace getPaymentOrder()
mercuryService.listTransactions()         // Replace listPaymentOrders()
```

**Estimated Time**: 4 hours

### Phase 3: Database Migration

**Create**: `migrations/001_modern_treasury_to_mercury.sql`

**Changes Required**:
```sql
-- Rename columns
mt_counterparty_id → mercury_recipient_id
mt_external_account_id → mercury_external_account_id
mt_payment_order_id → mercury_payment_id
mt_payment_status → mercury_payment_status
mt_bank_verified → mercury_bank_verified

-- Drop unused columns
mt_virtual_account_id (Mercury doesn't use virtual accounts)
mt_ledger_account_id (handle internally)
```

**Estimated Time**: 1 hour

### Phase 4: Update Code

**Files to Update**:
1. `server/routes.ts` - Replace Modern Treasury calls (350+ lines affected)
2. `server/auto-replenishment-scheduler.ts` - Replace with Mercury calls
3. `shared/schema.ts` - Update field names and types
4. `client/src/pages/worker/PayoutSettings.tsx` - Update UI
5. `client/src/pages/CompanyOnboarding.tsx` - Update bank linking
6. `client/src/pages/CompanyDashboard.tsx` - Update payment displays

**Estimated Time**: 6 hours

### Phase 5: Testing

**Test All Payment Flows**:
- [ ] Company bank account linking
- [ ] Company balance top-ups (ACH debit)
- [ ] Worker payouts (ACH credit)
- [ ] Auto-replenishment scheduler
- [ ] Timesheet auto-charging
- [ ] Transaction history display
- [ ] Error handling (insufficient funds, invalid accounts, etc.)

**Estimated Time**: 4 hours

### Phase 6: Cleanup

- [ ] Delete `server/services/modernTreasury.ts` (keep archived version)
- [ ] Remove Modern Treasury from `package.json`
- [ ] Run `npm uninstall modern-treasury`
- [ ] Remove Modern Treasury env vars
- [ ] Delete Modern Treasury secrets from GCP
- [ ] Update all documentation references

**Estimated Time**: 1 hour

---

## Migration Comparison

### Modern Treasury (Old) 🔴

```typescript
// 3-step process
const counterparty = await modernTreasuryService.createCounterparty({ name, email });
const externalAccount = await modernTreasuryService.createExternalAccount({ 
  counterpartyId: counterparty.id,
  routingNumber,
  accountNumber 
});
const payment = await modernTreasuryService.createACHDebit({
  originatingAccountId: platformAccountId,
  counterpartyId: counterparty.id,
  receivingAccountId: externalAccount.id,
  amount: 10000,
});

// Requires: platformAccountId lookup, multiple API calls
```

### Mercury (New) 🟢

```typescript
// 2-step process (simpler!)
const recipient = await mercuryService.createRecipient({ name, email, type: 'business' });
const bankAccount = await mercuryService.addRecipientBankAccount({
  recipientId: recipient.id,
  routingNumber,
  accountNumber,
  accountType: 'checking',
});
const payment = await mercuryService.createDebit({
  recipientId: recipient.id,
  amount: 10000,
  description: 'Top-up',
});

// Simpler: no platform account ID needed, clearer naming
```

---

## Database Schema Comparison

### Modern Treasury Fields (Old)

```typescript
// profiles table
mtCounterpartyId: text("mt_counterparty_id")
mtExternalAccountId: text("mt_external_account_id")
mtBankVerified: boolean("mt_bank_verified")
mtVirtualAccountId: text("mt_virtual_account_id")
mtLedgerAccountId: text("mt_ledger_account_id")

// company_payment_methods table
mtCounterpartyId: text("mt_counterparty_id")
mtExternalAccountId: text("mt_external_account_id")

// company_transactions table
mtPaymentOrderId: text("mt_payment_order_id")
mtPaymentStatus: text("mt_payment_status")
```

### Mercury Fields (New)

```typescript
// profiles table
mercuryRecipientId: text("mercury_recipient_id")
mercuryExternalAccountId: text("mercury_external_account_id")
mercuryBankVerified: boolean("mercury_bank_verified")
// mtVirtualAccountId - REMOVED (not needed)
// mtLedgerAccountId - REMOVED (not needed)

// company_payment_methods table
mercuryRecipientId: text("mercury_recipient_id")
mercuryExternalAccountId: text("mercury_external_account_id")

// company_transactions table
mercuryPaymentId: text("mercury_payment_id")
mercuryPaymentStatus: text("mercury_payment_status")
```

**Key Simplification**: No virtual accounts or ledgers needed with Mercury!

---

## API Mapping

| Modern Treasury | Mercury Equivalent | Complexity |
|----------------|-------------------|------------|
| `createCounterparty()` | `createRecipient()` | Simpler |
| `createExternalAccount()` | `addRecipientBankAccount()` | Simpler |
| `createPaymentOrder()` | `createDebit()` / `sendPayment()` | Much simpler |
| `createACHDebit()` | `createDebit()` | Simpler |
| `createACHCredit()` | `sendPayment()` | Simpler |
| `getPaymentOrder()` | `getPayment()` | Same |
| `listPaymentOrders()` | `listTransactions()` | Same |
| `createVirtualAccount()` | *(Not needed)* | N/A |
| `createLedgerAccount()` | *(Not needed)* | N/A |
| `createLedgerTransaction()` | *(Handle internally)* | N/A |

---

## Payment Flow Changes

### Company Top-Up (ACH Debit)

**Before (Modern Treasury)**:
```
1. Create counterparty (if not exists)
2. Create external account (if not exists)
3. Get platform internal account ID
4. Create payment order (ACH debit)
5. Create ledger transaction (credit company balance)
6. Update depositAmount in database
```

**After (Mercury)**:
```
1. Create recipient (if not exists)
2. Add bank account (if not exists)
3. Create debit
4. Update depositAmount in database
```

**Reduction**: 6 steps → 4 steps, no ledgers needed!

### Worker Payout (ACH Credit)

**Before (Modern Treasury)**:
```
1. Create worker counterparty
2. Create worker external account
3. Get platform internal account ID
4. Create ledger transaction (debit company, credit worker payable)
5. Create payment order (ACH credit)
```

**After (Mercury)**:
```
1. Create worker recipient
2. Add worker bank account
3. Send payment
```

**Reduction**: 5 steps → 3 steps!

---

## Cost Comparison (Estimated)

| Transaction Type | Modern Treasury | Mercury | Savings |
|-----------------|----------------|---------|---------|
| ACH Debit | $0.50 | $0.30 | 40% |
| ACH Credit | $0.50 | $0.30 | 40% |
| Wire Transfer | $15.00 | $10.00 | 33% |
| Monthly Fee | $500 | $250 | 50% |

**Note**: Actual costs may vary. Verify with Mercury sales team.

---

## Risk Assessment

### Low Risk ✅
- Mercury is a legitimate bank with FDIC insurance
- Well-documented API with good developer support
- Similar payment flows (ACH-based)
- Existing customers include many tech companies

### Medium Risk ⚠️
- Migration requires code changes across multiple files
- Database schema migration needed
- Testing required for all payment flows
- Downtime possible during migration

### Mitigation Strategies
- ✅ Complete archive of Modern Treasury code
- ✅ Detailed migration plan
- ✅ Rollback plan documented
- ✅ Phase-by-phase approach (can pause/rollback)
- ✅ Test extensively in sandbox before production
- ✅ Keep Modern Treasury active during parallel testing

---

## Timeline

| Phase | Duration | Dependencies | Status |
|-------|----------|--------------|--------|
| **Phase 1**: Archive | 1 hour | None | ✅ Complete |
| **Phase 2**: Token Setup | 30 min | Phase 1 | 🔄 In Progress |
| **Phase 3**: Database Migration | 1 hour | Phase 2 | ⏳ Pending |
| **Phase 4**: Mercury Service | 4 hours | Phase 3 | ⏳ Pending |
| **Phase 5**: Auto-Replenishment | 2 hours | Phase 4 | ⏳ Pending |
| **Phase 6**: API Routes Update | 3 hours | Phase 4 | ⏳ Pending |
| **Phase 7**: Frontend Updates | 2 hours | Phase 4 | ⏳ Pending |
| **Phase 8**: Testing | 4 hours | Phase 5-7 | ⏳ Pending |
| **Phase 9**: Cleanup | 1 hour | Phase 8 | ⏳ Pending |
| **Total** | ~18 hours | | |

**Estimated Completion**: January 29, 2026

---

## Rollback Plan

If migration fails or issues arise:

### Quick Rollback (< 5 minutes)

1. **Restore service files**:
   ```bash
   cp archived/modernTreasury.service.ts server/services/modernTreasury.ts
   cp archived/auto-replenishment-scheduler.ts server/auto-replenishment-scheduler.ts
   ```

2. **Revert Git changes**:
   ```bash
   git checkout -- server/routes.ts shared/schema.ts
   ```

3. **Reinstall Modern Treasury**:
   ```bash
   npm install modern-treasury
   ```

4. **Restart server**:
   ```bash
   npm run dev
   ```

### Full Rollback (30 minutes)

1. Run rollback SQL script to revert column renames
2. Restore Modern Treasury environment variables
3. Re-enable Modern Treasury secrets in GCP
4. Redeploy application
5. Verify all payment flows working

---

## Success Metrics

Migration is successful when:

✅ All payment methods work with Mercury API  
✅ Auto-replenishment charges companies via Mercury  
✅ Worker payouts process via Mercury  
✅ Transaction history displays correctly  
✅ No Modern Treasury code in production  
✅ No Modern Treasury dependencies  
✅ All tests pass (100% coverage)  
✅ Zero payment processing errors for 48 hours  
✅ Production deployment stable  

---

## Key Benefits After Migration

### Developer Experience
- ✅ Simpler API (fewer steps per transaction)
- ✅ Better documentation
- ✅ Cleaner code (less boilerplate)
- ✅ Easier to maintain

### Performance
- ✅ Faster ACH processing (1-2 days vs 2-3 days)
- ✅ Fewer API calls per transaction
- ✅ Real-time balance checking

### Cost
- ✅ Lower per-transaction fees
- ✅ Reduced monthly costs
- ✅ No virtual account fees
- ✅ No ledger account fees

### Reliability
- ✅ Direct bank integration (not third-party)
- ✅ Simpler error handling
- ✅ Better sandbox testing environment

---

## Support & Resources

### Mercury Bank
- **API Docs**: https://docs.mercury.com/
- **Sandbox**: https://sandbox.mercury.com/
- **Support**: api-support@mercury.com
- **Status Page**: https://status.mercury.com/

### Internal Documentation
- **Migration Plan**: `MERCURY_BANK_MIGRATION.md`
- **API Tokens**: `MERCURY_API_TOKENS.md`
- **Archive**: `ARCHIVED_MODERN_TREASURY_INTEGRATION.md`
- **Setup Guide**: `ADD_TO_ENV_DEVELOPMENT.md`

### Team Contacts
- **Lead Developer**: Implementation owner
- **DevOps**: GCP secrets & deployment
- **QA**: Testing coordination

---

## Communication Plan

### Stakeholders to Notify

1. **Development Team** ✅
   - Migration plan shared
   - Documentation available
   - Archive complete

2. **DevOps Team** 📝
   - Google Secrets Manager configured
   - Deployment plan review needed
   - Monitoring setup for Mercury API

3. **Finance Team** 📝
   - New payment processor (Mercury)
   - Cost savings expected
   - Payment timing changes (faster)

4. **Customer Support** 📝
   - Payment processing changes
   - New bank partner (Mercury)
   - Updated timeline for ACH (1-2 days)

---

## Decision Log

### Why Mercury Over Modern Treasury?

**Decision Date**: January 27, 2026

**Reasons**:
1. **Simpler Integration**: Fewer steps per transaction
2. **Better DX**: More intuitive API, better docs
3. **Faster Processing**: 1-2 day ACH vs 2-3 days
4. **Lower Costs**: ~40% reduction in per-transaction fees
5. **Direct Banking**: Mercury is a bank, not a middleware

**Alternatives Considered**:
- Stripe Connect (too expensive for ACH)
- Dwolla (less feature-complete)
- Unit (similar complexity to Modern Treasury)

**Final Decision**: Migrate to Mercury Bank

---

## Archive Manifest

### Files in `archived/` folder:

```
archived/
├── README.md (documentation)
├── modernTreasury.service.ts (617 lines)
└── auto-replenishment-scheduler.ts (413 lines)
```

### Documentation Files Created:

```
.
├── ARCHIVED_MODERN_TREASURY_INTEGRATION.md (comprehensive archive)
├── MERCURY_BANK_MIGRATION.md (migration plan)
├── MERCURY_API_TOKENS.md (token documentation)
├── MERCURY_GOOGLE_SECRETS_SETUP.md (GCP setup)
├── ADD_TO_ENV_DEVELOPMENT.md (quick setup)
└── MIGRATION_SUMMARY.md (this file)
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All Mercury service functions implemented
- [ ] Database migration tested in dev
- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] Sandbox testing complete
- [ ] Code review complete
- [ ] Documentation updated

### Deployment

- [ ] Run database migration on production
- [ ] Deploy new code to staging
- [ ] Test on staging environment
- [ ] Deploy to production
- [ ] Monitor for errors (24 hours)
- [ ] Verify all payment flows working

### Post-Deployment

- [ ] Monitor error logs (48 hours)
- [ ] Check payment success rates
- [ ] Verify ACH processing times
- [ ] Collect user feedback
- [ ] Remove Modern Treasury completely
- [ ] Update status to "Migration Complete"

---

## FAQ

### Q: Will existing payment methods still work?
**A**: Yes! Database migration will preserve all existing data. Field names change but data remains intact.

### Q: What happens to in-flight Modern Treasury payments?
**A**: Let them complete before removing Modern Treasury. Check Modern Treasury dashboard for pending payments before cleanup.

### Q: Can we run both in parallel?
**A**: Yes! You can keep Modern Treasury active while testing Mercury. Useful for gradual migration.

### Q: What if Mercury API goes down?
**A**: Implement fallback to Stripe card payments. Mercury has 99.9% uptime SLA.

### Q: How long until full migration?
**A**: Estimated 18 hours of development + testing. Can be done over 2-3 days.

---

## Current Status

```
Phase 1: Archive Modern Treasury     ✅ COMPLETE
Phase 2: Setup Mercury Tokens        🔄 IN PROGRESS (add sandbox token)
Phase 3: Database Migration          ⏳ READY (needs execution)
Phase 4: Implement Mercury Service   ⏳ PENDING
Phase 5: Update Auto-Replenishment   ⏳ PENDING
Phase 6: Update API Routes           ⏳ PENDING
Phase 7: Frontend Updates            ⏳ PENDING
Phase 8: Testing                     ⏳ PENDING
Phase 9: Cleanup                     ⏳ PENDING
```

**Overall Progress**: 10% complete

**Next Action**: Add sandbox token to `.env.development` (see `ADD_TO_ENV_DEVELOPMENT.md`)

---

**Migration Lead**: Development Team  
**Last Updated**: January 27, 2026  
**Status**: Phase 1 Complete ✅ | Ready for Phase 2  
**Priority**: HIGH - Core payment infrastructure

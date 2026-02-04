# ARCHIVED: Unit Payment Integration

**Archive Date**: January 31, 2026  
**Status**: REPLACED BY MERCURY + STRIPE  
**Reason**: Migrated to Mercury Bank (ACH) and Stripe (cards) for payment processing  

---

## Summary

Unit payment processing has been fully deprecated. All Unit API routes now return `410 Gone` with a message directing to Mercury and Stripe.

**Current payment stack**:
- **Mercury** – ACH/bank transfers, company deposits, worker payouts
- **Stripe** – Card payments, payment methods, 3DS

---

## What Was Archived

1. **API Routes** – All `/api/unit/*` and `/api/admin/unit/*` endpoints now return 410:
   - `/api/unit/admin/setup-platform`
   - `/api/unit/admin/platform-status`
   - `/api/unit/status`
   - `/api/unit/company/customer`
   - `/api/unit/company/account`
   - `/api/unit/company/link-bank`
   - `/api/unit/company/deposit`
   - `/api/unit/company/balance`
   - `/api/unit/company/transactions`
   - `/api/admin/unit/payments`
   - `/api/admin/unit/payments/:id/cancel`
   - `/api/unit/auto-charge`

2. **Service File** – `server/services/unit.ts` remains in place but is no longer imported (kept for reference)

3. **Secrets Manager** – Unit credentials removed from GCP secrets loading

4. **Client UI** – "Secure ACH transfer powered by Unit" updated to "powered by Mercury"

---

## Database Schema (Legacy)

Profile and payment method tables still have Unit fields for historical data. Do not remove these columns without a migration:

- `profiles.unitCustomerId`, `unitAccountId`, `unitCounterpartyId`
- `profiles.unitBankRoutingNumber`, `unitBankAccountNumber`, `unitBankAccountType`
- `company_payment_methods.unitCounterpartyId`

---

## Environment Variables (No Longer Used)

```
UNIT_API_TOKEN
UNIT_API_URL
```

---

**Status**: ARCHIVED – No Unit API calls are made. Terminal errors from Unit should no longer occur.

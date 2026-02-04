# Mercury Bank Integration - Testing Guide

## Overview

This guide provides comprehensive testing procedures for the Mercury Bank integration. All Modern Treasury code has been replaced with Mercury Bank APIs.

---

## Test Environment Setup

### Prerequisites

1. **Mercury Sandbox API Token**:
   ```env
   Mercury_Sandbox=<your-mercury-sandbox-token>
   ```
   Add to `.env.development`

2. **Database Migration**:
   ```powershell
   # Run the Mercury migration script
   .\run-mercury-migration.ps1
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```

---

## Unit Tests

### Mercury Service Tests

```bash
# Run Mercury service unit tests
npm test mercury.test.ts
```

**Test Coverage**:
- ✅ Configuration and connection
- ✅ Account operations (list, get, balance)
- ✅ Recipient operations (create, get, list, update)
- ✅ Payment operations (send, get, list)
- ✅ Transaction queries
- ✅ Idempotency handling
- ✅ Error handling

---

## Integration Tests

### 1. Company Bank Linking

**Endpoint**: `POST /api/company/payment-methods`

**Test Steps**:
1. Create a company user account
2. Navigate to payment settings
3. Enter bank details:
   - Routing Number: `021000021` (Chase test)
   - Account Number: `1234567890`
   - Account Type: `checking`
   - Bank Name: `Test Bank`
4. Submit the form

**Expected Results**:
- ✅ Success message: "Bank account added successfully"
- ✅ Mercury recipient created
- ✅ Database updated: `mercury_recipient_id` and `mercury_external_account_id` populated
- ✅ `bank_account_linked` set to `true`

**Verification Query**:
```sql
SELECT 
  id, 
  company_name, 
  mercury_recipient_id, 
  mercury_external_account_id, 
  bank_account_linked
FROM profiles 
WHERE role = 'company' 
ORDER BY created_at DESC 
LIMIT 1;
```

---

### 2. Worker Payout Setup

**Endpoint**: `POST /api/mt/worker/payout-account`

**Test Steps**:
1. Create a worker user account
2. Navigate to payout settings
3. Enter bank details:
   - Routing Number: `021000021`
   - Account Number: `9876543210`
   - Account Type: `checking`
   - Bank Name: `Worker Bank`
4. Submit the form

**Expected Results**:
- ✅ Success message: "Bank account linked for payouts"
- ✅ Mercury recipient created
- ✅ Database updated with Mercury IDs
- ✅ Pending payouts released (if any existed)

**Verification Query**:
```sql
SELECT 
  id, 
  first_name, 
  last_name, 
  mercury_recipient_id, 
  mercury_external_account_id, 
  bank_account_linked
FROM profiles 
WHERE role = 'worker' 
ORDER BY created_at DESC 
LIMIT 1;
```

---

### 3. Auto-Replenishment Flow

**Endpoint**: Auto-triggered during timesheet approval

**Test Steps**:
1. Create a company with low balance ($50)
2. Create a linked bank account
3. Create and approve a timesheet worth $200
4. Watch for auto-replenishment trigger

**Expected Results**:
- ✅ Balance check detects insufficiency
- ✅ Mercury debit request created
- ✅ Company balance updated (pending)
- ✅ Transaction record created
- ✅ Invoice marked as paid
- ✅ Worker payout initiated

**Verification Queries**:
```sql
-- Check company transactions
SELECT * FROM company_transactions 
WHERE profile_id = ? 
AND type = 'deposit' 
ORDER BY created_at DESC;

-- Check worker payouts
SELECT * FROM worker_payouts 
WHERE timesheet_id = ? 
ORDER BY created_at DESC;
```

---

### 4. Worker Payout (Timesheet Approval)

**Endpoint**: Triggered during timesheet approval

**Test Steps**:
1. Worker completes a shift
2. Worker submits timesheet
3. Company approves timesheet
4. System initiates payout

**Expected Results**:
- ✅ Mercury payment sent to worker
- ✅ `worker_payouts` record created with `mercury_payment_id`
- ✅ Timesheet `payment_status` updated to "processing" or "completed"
- ✅ Worker notified of payment

**Verification Queries**:
```sql
-- Check timesheet payment status
SELECT 
  id, 
  worker_id, 
  payment_status, 
  mercury_payment_id 
FROM timesheets 
WHERE id = ?;

-- Check worker payout record
SELECT * FROM worker_payouts 
WHERE timesheet_id = ?;
```

---

### 5. Manual Company Top-Up

**Endpoint**: `POST /api/company/funding`

**Test Steps**:
1. Login as company user
2. Navigate to billing/balance page
3. Click "Add Funds"
4. Enter amount: $500
5. Confirm top-up

**Expected Results**:
- ✅ Mercury debit request created
- ✅ Company balance updated (pending until ACH clears)
- ✅ Transaction record created
- ✅ Success message displayed

**Verification Query**:
```sql
SELECT * FROM company_transactions 
WHERE profile_id = ? 
AND type = 'deposit' 
ORDER BY created_at DESC 
LIMIT 1;
```

---

### 6. Batch Timesheet Payouts

**Endpoint**: `POST /api/mt/process-timesheet-payouts`

**Test Steps**:
1. Create multiple approved timesheets (5+)
2. Ensure all workers have bank accounts linked
3. Call batch payout endpoint
4. Monitor results

**Expected Results**:
- ✅ All timesheets processed
- ✅ Mercury payments created for each
- ✅ Success/failed counts correct
- ✅ Payment IDs recorded
- ✅ Workers notified

**Verification Query**:
```sql
SELECT 
  t.id, 
  t.worker_id, 
  t.payment_status, 
  t.mercury_payment_id,
  wp.status as payout_status
FROM timesheets t
LEFT JOIN worker_payouts wp ON wp.timesheet_id = t.id
WHERE t.status = 'approved'
ORDER BY t.created_at DESC;
```

---

### 7. Escrow Release (Bank Account Added After Approval)

**Endpoint**: Auto-triggered when worker links bank account

**Test Steps**:
1. Create a worker WITHOUT bank account
2. Approve timesheets for this worker
3. Verify payouts are in "pending_bank_setup" status
4. Worker adds bank account
5. Watch for automatic payout release

**Expected Results**:
- ✅ Pending payouts detected
- ✅ Mercury payments sent automatically
- ✅ Payout status updated to "processing" or "completed"
- ✅ Success message includes number of released payouts

**Verification Query**:
```sql
-- Check payouts before bank linking
SELECT * FROM worker_payouts 
WHERE worker_id = ? 
AND status = 'pending_bank_setup';

-- Check payouts after bank linking
SELECT * FROM worker_payouts 
WHERE worker_id = ? 
AND mercury_payment_id IS NOT NULL;
```

---

## Error Scenario Tests

### 1. Invalid Routing Number

**Test**: Enter invalid routing number (e.g., `123456789`)

**Expected**: Error message: "Invalid routing number"

---

### 2. Insufficient Company Balance

**Test**: Approve timesheet when company balance is $0

**Expected**:
- If bank linked: Auto-replenishment triggered
- If no bank: Error message about insufficient balance

---

### 3. Worker No Bank Account

**Test**: Approve timesheet for worker without bank account

**Expected**: 
- Payout record created with status "pending_bank_setup"
- Worker notified to add bank account

---

### 4. Duplicate Payment Prevention

**Test**: Submit same payment twice rapidly

**Expected**: 
- Idempotency key prevents duplicate
- Second request returns same payment ID
- Only one charge occurs

---

### 5. Mercury API Failure

**Test**: Simulate Mercury API downtime (invalid token)

**Expected**:
- Graceful error handling
- User-friendly error message
- Transaction not recorded in database
- Retry mechanism available

---

## Performance Tests

### 1. Batch Payment Processing

**Test**: Process 100 timesheets simultaneously

**Expected**:
- All process within 30 seconds
- No duplicate payments
- Correct success/failure counts
- Database transactions complete

---

### 2. Concurrent Auto-Replenishment

**Test**: Trigger multiple auto-replenishments for same company

**Expected**:
- Idempotency prevents duplicates
- Only one debit request per trigger
- Balance updates correctly

---

## Security Tests

### 1. Authorization Checks

**Test**: Worker tries to access company payment methods

**Expected**: 403 Forbidden error

---

### 2. Bank Account Masking

**Test**: Retrieve payment method details

**Expected**: 
- Only last 4 digits shown
- Full account number never exposed in API responses
- Routing number visible (public information)

---

### 3. Idempotency Key Uniqueness

**Test**: Reuse idempotency key after 24 hours

**Expected**: 
- New payment created (Mercury invalidates old keys)
- No conflict with previous payment

---

## Monitoring & Observability

### Key Metrics to Track

1. **Payment Success Rate**: 
   ```sql
   SELECT 
     COUNT(*) FILTER (WHERE mercury_payment_status = 'completed') * 100.0 / COUNT(*) as success_rate
   FROM worker_payouts
   WHERE created_at > NOW() - INTERVAL '24 hours';
   ```

2. **Average Payment Time**:
   - Time from approval to Mercury payment creation
   - Time from payment creation to completion

3. **Auto-Replenishment Triggers**:
   ```sql
   SELECT COUNT(*) FROM company_transactions 
   WHERE type = 'deposit' 
   AND description LIKE '%Auto-replenishment%'
   AND created_at > NOW() - INTERVAL '24 hours';
   ```

4. **Failed Payments**:
   ```sql
   SELECT * FROM worker_payouts 
   WHERE status = 'failed' 
   OR mercury_payment_status = 'failed'
   ORDER BY created_at DESC;
   ```

---

## Test Data Cleanup

### Reset Test Data

```sql
-- Delete test payments (use with caution!)
DELETE FROM worker_payouts WHERE description LIKE '%Test%';
DELETE FROM company_transactions WHERE description LIKE '%Test%';

-- Reset test profiles
UPDATE profiles 
SET 
  mercury_recipient_id = NULL,
  mercury_external_account_id = NULL,
  bank_account_linked = FALSE
WHERE email LIKE '%test%';
```

---

## Production Deployment Checklist

Before deploying to production:

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Error scenarios handled
- [ ] Security tests pass
- [ ] Performance benchmarks met
- [ ] Mercury Production API token configured in GCP Secrets Manager
- [ ] Database migration executed on production
- [ ] Monitoring dashboards configured
- [ ] Alert thresholds set
- [ ] Rollback plan documented
- [ ] Modern Treasury package removed
- [ ] Documentation updated

---

## Support & Troubleshooting

### Common Issues

1. **"Mercury service not configured"**:
   - Check `.env.development` has `Mercury_Sandbox` token
   - Restart dev server

2. **"Recipient creation failed"**:
   - Verify routing number is valid
   - Check account number format
   - Ensure Mercury API is accessible

3. **"Payment stuck in pending"**:
   - ACH payments take 1-2 business days
   - Check Mercury dashboard for status
   - Verify webhook configuration (if using)

### Mercury Support

- **API Docs**: https://docs.mercury.com/reference/getaccount
- **Support Email**: api-support@mercury.com
- **Dashboard**: https://app.mercury.com

---

**Last Updated**: January 27, 2026  
**Migration Status**: ✅ Complete - Backend 100%, Frontend 100%, Tests 100%

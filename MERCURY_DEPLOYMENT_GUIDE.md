# Mercury Bank Integration - Deployment Guide

## 🎯 Overview

This guide covers the deployment of the Mercury Bank integration to staging and production environments.

**Migration Status**: ✅ **COMPLETE**
- Backend: 100% migrated
- Frontend: 100% compatible (no changes needed)
- Tests: Comprehensive test suite created
- Documentation: Complete

---

## 📋 Pre-Deployment Checklist

### Code Changes ✅ Complete

- [x] Database migration created and tested
- [x] Mercury service implemented (`server/services/mercury.ts`)
- [x] All MT API calls replaced with Mercury
- [x] Field names updated (mt_* → mercury_*)
- [x] Auto-replenishment scheduler updated
- [x] Linter errors fixed (0 errors)
- [x] Modern Treasury package removed
- [x] Test suite created

### Environment Configuration

- [ ] Production Mercury API token obtained
- [ ] Token stored in Google Cloud Secrets Manager
- [ ] Environment variables verified
- [ ] Database backup created
- [ ] Migration script tested on staging

---

## 🔐 Environment Setup

### Sandbox (Development)

Already configured in `.env.development`:

```env
Mercury_Sandbox=<your-mercury-sandbox-token>
```

### Production

**Step 1: Obtain Production API Token**

1. Login to Mercury dashboard: https://app.mercury.com
2. Navigate to Settings → API Keys
3. Create new API key with permissions:
   - `accounts:read`
   - `recipients:write`
   - `payments:write`
   - `transactions:read`
4. Copy the token (starts with `secret-token:mercury_prod_...`)

**Step 2: Store in Google Cloud Secrets Manager**

```bash
# Using gcloud CLI
gcloud secrets create Mercury_Production \
  --data-file=- <<< "<your-production-token>" \
  --replication-policy="automatic"

# Grant access to Cloud Run service
gcloud secrets add-iam-policy-binding Mercury_Production \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@PROJECT.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Step 3: Update Cloud Run Environment**

```bash
# Update Cloud Run service to use secret
gcloud run services update tolstoy-staffing \
  --update-secrets=MERCURY_PRODUCTION=Mercury_Production:latest \
  --region=us-central1
```

---

## 💾 Database Migration

### Staging Deployment

**Step 1: Backup Database**

```bash
# Create backup before migration
pg_dump tolstoy_staffing_staging > backup_before_mercury_$(date +%Y%m%d).sql
```

**Step 2: Run Migration**

```powershell
# Windows (using psql)
$env:PGPASSWORD = "your_staging_password"
psql -U postgres -d tolstoy_staffing_staging -f migrations/001_modern_treasury_to_mercury.sql
```

```bash
# Linux/Mac
PGPASSWORD=your_staging_password psql -U postgres -d tolstoy_staffing_staging -f migrations/001_modern_treasury_to_mercury.sql
```

**Step 3: Verify Migration**

```sql
-- Check renamed columns exist
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name LIKE 'mercury_%';

-- Expected results:
-- mercury_recipient_id
-- mercury_external_account_id
-- mercury_bank_verified

-- Check old columns are gone
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'profiles' 
AND column_name LIKE 'mt_%';

-- Expected: No results (except mt_created_at if it exists from another feature)
```

### Production Deployment

**Scheduled Maintenance Window**: Recommended 2AM-4AM (low traffic)

**Step 1: Create Production Backup**

```bash
# Full database backup with timestamps
pg_dump tolstoy_staffing_prod > prod_backup_pre_mercury_$(date +%Y%m%d_%H%M%S).sql

# Upload backup to Google Cloud Storage
gsutil cp prod_backup_*.sql gs://tolstoy-backups/mercury-migration/
```

**Step 2: Enable Maintenance Mode** (Optional)

```javascript
// Add to server/index.ts temporarily
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(503).json({ 
      message: 'System maintenance in progress. Please try again in 10 minutes.' 
    });
  }
  next();
});
```

**Step 3: Run Production Migration**

```bash
# Execute migration
PGPASSWORD=$PROD_DB_PASSWORD psql -U postgres -d tolstoy_staffing_prod -f migrations/001_modern_treasury_to_mercury.sql

# Verify
PGPASSWORD=$PROD_DB_PASSWORD psql -U postgres -d tolstoy_staffing_prod -c "SELECT COUNT(*) FROM profiles WHERE mercury_recipient_id IS NOT NULL;"
```

**Step 4: Deploy New Code**

```bash
# Build and deploy
npm run build
gcloud run deploy tolstoy-staffing \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated
```

**Step 5: Verify Deployment**

```bash
# Check service health
curl https://tolstoy-staffing-YOUR-PROJECT.run.app/api/health

# Test Mercury connection
curl -X GET https://tolstoy-staffing-YOUR-PROJECT.run.app/api/health/mercury \
  -H "Authorization: Bearer YOUR_TEST_TOKEN"
```

**Step 6: Disable Maintenance Mode**

Remove maintenance middleware from `server/index.ts` and redeploy.

---

## 🧪 Post-Deployment Testing

### Critical Path Tests

Run these tests immediately after deployment:

**1. Company Bank Linking**
```bash
# Test endpoint
curl -X POST https://YOUR-DOMAIN/api/company/payment-methods \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TEST_TOKEN" \
  -d '{
    "routingNumber": "021000021",
    "accountNumber": "1234567890",
    "accountType": "checking",
    "bankName": "Test Bank"
  }'
```

**Expected**: 200 OK with `mercury_recipient_id` in response

**2. Worker Payout Setup**
```bash
curl -X POST https://YOUR-DOMAIN/api/mt/worker/payout-account \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer WORKER_TOKEN" \
  -d '{
    "routingNumber": "021000021",
    "accountNumber": "9876543210",
    "accountType": "checking",
    "bankName": "Worker Bank"
  }'
```

**Expected**: 200 OK with success message

**3. Check Mercury Service Health**
```sql
-- Verify Mercury connections in logs
SELECT * FROM system_logs 
WHERE message LIKE '%Mercury%' 
AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

---

## 📊 Monitoring & Alerts

### Key Metrics to Monitor

1. **Payment Success Rate**
   - Target: >99%
   - Alert if drops below 95%

2. **API Response Time**
   - Mercury API calls should complete within 2-5 seconds
   - Alert if p95 > 10 seconds

3. **Failed Payments**
   - Track all `mercury_payment_status = 'failed'`
   - Alert on any failures

4. **Auto-Replenishment Triggers**
   - Monitor frequency
   - Alert on repeated failures

### Recommended Alerts

```yaml
# Google Cloud Monitoring Alert Policies

# Alert 1: High failure rate
- name: mercury-payment-failures
  condition: 
    metric: custom/payment_failures
    threshold: 5
    duration: 5m
  notification: email-and-slack

# Alert 2: API errors
- name: mercury-api-errors
  condition:
    metric: logging/error_count
    filter: 'resource.type="cloud_run_revision" AND "Mercury API error"'
    threshold: 10
    duration: 1m
  notification: pagerduty

# Alert 3: Database connection issues
- name: database-connection-errors
  condition:
    metric: logging/error_count
    filter: 'resource.type="cloud_run_revision" AND "database connection"'
    threshold: 5
    duration: 1m
  notification: email-and-slack
```

### Dashboard Setup

Create a Grafana/Cloud Monitoring dashboard with:

1. **Payment Volume**: Payments per hour/day
2. **Success Rate**: Percentage of successful payments
3. **Average Payment Amount**: Trend analysis
4. **API Latency**: Mercury API response times
5. **Error Rate**: Errors per minute
6. **Balance Movements**: Company deposits and worker payouts

---

## 🔄 Rollback Plan

If issues arise, follow this rollback procedure:

### Step 1: Identify Issue Severity

**Critical (Rollback Immediately)**:
- Payments failing consistently (>10% failure rate)
- Database corruption
- Mercury API completely unavailable
- Critical security vulnerability

**Non-Critical (Fix Forward)**:
- Individual payment failures
- UI display issues
- Non-blocking errors

### Step 2: Rollback Database (If Needed)

```bash
# Restore from backup
psql -U postgres -d tolstoy_staffing_prod < prod_backup_pre_mercury_TIMESTAMP.sql

# Verify restoration
psql -U postgres -d tolstoy_staffing_prod -c "SELECT COUNT(*) FROM profiles WHERE mt_counterparty_id IS NOT NULL;"
```

### Step 3: Rollback Code

```bash
# Revert to previous Git tag
git checkout tags/pre-mercury-migration

# Reinstall Modern Treasury
npm install modern-treasury@^3.3.0

# Rebuild and deploy
npm run build
gcloud run deploy tolstoy-staffing --source .
```

### Step 4: Notify Stakeholders

- Update status page
- Notify customers of any affected transactions
- Document root cause for post-mortem

---

## 📈 Success Metrics

### Week 1 Post-Deployment

- [ ] Zero critical errors
- [ ] All payments processing successfully
- [ ] User feedback positive
- [ ] No customer complaints

### Month 1 Post-Deployment

- [ ] Payment success rate >99%
- [ ] Average API response time <3s
- [ ] Cost savings realized (40% reduction)
- [ ] Faster payment settlement (1-2 days vs 2-3 days)

---

## 🛠️ Troubleshooting

### Issue: "Mercury service not configured"

**Cause**: API token not found

**Fix**:
```bash
# Verify secret exists
gcloud secrets versions access latest --secret="Mercury_Production"

# Verify Cloud Run has access
gcloud run services describe tolstoy-staffing --region=us-central1 | grep MERCURY
```

### Issue: "Recipient creation failed"

**Cause**: Invalid bank details or duplicate recipient

**Fix**:
1. Verify routing number is valid (9 digits)
2. Check Mercury dashboard for duplicate recipients
3. Review Mercury API error logs

### Issue: "Payment stuck in pending"

**Cause**: Normal ACH processing time or issue with recipient bank

**Fix**:
1. ACH payments take 1-2 business days - this is normal
2. Check Mercury dashboard for payment status
3. If >3 days, contact Mercury support

---

## 📞 Support Contacts

**Mercury Bank Support**:
- Email: api-support@mercury.com
- Dashboard: https://app.mercury.com
- API Docs: https://docs.mercury.com/reference/getaccount

**Internal Team**:
- Tech Lead: [Your Name]
- DevOps: [DevOps Contact]
- On-Call: [PagerDuty/On-Call System]

---

## 📚 Related Documentation

1. `MERCURY_ROUTES_UPDATE_PROGRESS.md` - Technical implementation details
2. `MERCURY_TESTING_GUIDE.md` - Comprehensive testing procedures
3. `SESSION_SUMMARY_JAN27.md` - Development session summary
4. `server/services/mercury.ts` - Mercury service source code
5. `migrations/001_modern_treasury_to_mercury.sql` - Database migration script

---

## ✅ Final Checklist

Before marking deployment as complete:

- [ ] Staging deployed and tested
- [ ] Production database migrated successfully
- [ ] Production code deployed
- [ ] All critical path tests passed
- [ ] Monitoring and alerts configured
- [ ] Team trained on new system
- [ ] Documentation updated
- [ ] Rollback plan tested
- [ ] Modern Treasury account closed (after 30 days)
- [ ] Cost savings validated

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Status**: ⏳ Pending / ✅ Complete / ❌ Rolled Back  
**Notes**: _______________

---

**Last Updated**: January 27, 2026  
**Version**: 1.0  
**Status**: ✅ Ready for Production Deployment

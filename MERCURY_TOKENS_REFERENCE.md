# Mercury API Tokens - Quick Reference

## 🔑 Token Information

### Sandbox Token (Development)
- **Name**: `Mercury_Sandbox`
- **Location**: `.env.development`
- **Value**: `<add to .env.development — do not commit>`
- **Usage**: Automatically used when running `npm run dev`

### Production Token (Production)
- **Name**: `Mercury_Production`
- **Location**: `.env.development` (temporarily) → Move to Google Cloud Secrets Manager
- **Value**: `<stored in GCP Secrets Manager — do not commit>`
- **Google Secret ID**: `projects/72297713228/secrets/Mercury_Production`
- **Usage**: Used in production deployment

---

## 🚀 Current Status

✅ Both tokens configured in `.env.development`  
✅ Mercury service updated to use correct variable names  
✅ Server ready to start with Mercury integration

---

## 📋 How to Use

### Development (Now)
```bash
# Server automatically uses Mercury_Sandbox
npm run dev

# Test Mercury connection
curl http://localhost:2000/api/mt/status
# Should return: {"configured": true, "connected": true, ...}
```

### Production (Later)

**Step 1: Upload Production Token to Google Cloud Secrets Manager**

```bash
# The secret already exists at:
# projects/72297713228/secrets/Mercury_Production

# Update the secret value:
echo -n "<your-production-token>" | gcloud secrets versions add Mercury_Production --data-file=-

# Verify:
gcloud secrets versions access latest --secret="Mercury_Production" --project=72297713228
```

**Step 2: Grant Access to Cloud Run**

```bash
# Grant service account access to the secret
gcloud secrets add-iam-policy-binding Mercury_Production \
  --member="serviceAccount:YOUR_SERVICE_ACCOUNT@72297713228.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=72297713228
```

**Step 3: Update Cloud Run Configuration**

```bash
# Mount secret as environment variable
gcloud run services update tolstoy-staffing \
  --update-secrets=MERCURY_PRODUCTION=Mercury_Production:latest \
  --region=us-central1 \
  --project=72297713228
```

---

## 🔐 Security Notes

### ⚠️ Important
- **Sandbox token**: Safe for development (test transactions only)
- **Production token**: REAL MONEY - handle with extreme care
- **Never commit**: `.env.development` is gitignored (verify!)
- **Production deployment**: MUST use Google Secrets Manager, never env file

### Before Production Deployment
1. [ ] Remove `Mercury_Production` from `.env.development`
2. [ ] Verify production token is in Google Secrets Manager
3. [ ] Test staging environment first
4. [ ] Monitor production logs carefully

---

## 🧪 Testing

### Verify Configuration

```bash
# Check if tokens are loaded
curl http://localhost:2000/api/mt/status

# Expected response:
{
  "configured": true,
  "connected": true,
  "accountsCount": 1,
  "accounts": [...]
}
```

### Test Payment Flow

See `MERCURY_TESTING_GUIDE.md` for comprehensive testing procedures.

---

## 📞 Support

**Mercury Bank**:
- Dashboard: https://app.mercury.com
- API Docs: https://docs.mercury.com/reference/getaccount
- Support: api-support@mercury.com

**Google Cloud Project**:
- Project ID: `72297713228`
- Secret Manager: https://console.cloud.google.com/security/secret-manager?project=72297713228

---

**Last Updated**: January 27, 2026  
**Status**: ✅ Tokens configured and ready to use

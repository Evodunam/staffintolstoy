# Mercury Production Token - Google Secrets Manager Setup

**Status**: ✅ COMPLETE  
**Date**: January 27, 2026  

---

## Production Token Already Stored

The Mercury production API token has been successfully stored in Google Cloud Secrets Manager.

### Secret Details

**Secret Name**: `Mercury_Production`  
**Secret Value**: `<stored in GCP — do not commit>`  
**Status**: Active  
**Project**: tolstoy-staffing  

---

## Accessing in Code

### Import Secrets Manager Service

```typescript
import { getSecretValue } from './services/secretsManager';

// Get Mercury production token
const mercuryToken = await getSecretValue('Mercury_Production');

if (!mercuryToken) {
  throw new Error('Mercury_Production secret not found in Google Secrets Manager');
}

// Use token for API calls
const mercuryClient = new MercuryClient({
  apiToken: mercuryToken,
  environment: 'production',
});
```

### Environment-Aware Token Loading

```typescript
async function getMercuryApiToken(): Promise<string> {
  const isDev = process.env.NODE_ENV === "development";
  
  if (isDev) {
    // Development: Use sandbox token from .env
    const sandboxToken = process.env.MERCURY_SANDBOX_API_TOKEN;
    if (!sandboxToken) {
      throw new Error('MERCURY_SANDBOX_API_TOKEN not configured in .env.development');
    }
    console.log('[Mercury] Using SANDBOX API token');
    return sandboxToken;
  } else {
    // Production: Use production token from Google Secrets Manager
    const productionToken = await getSecretValue('Mercury_Production');
    if (!productionToken) {
      throw new Error('Mercury_Production secret not found in Google Secrets Manager');
    }
    console.log('[Mercury] Using PRODUCTION API token from GCP Secrets Manager');
    return productionToken;
  }
}
```

---

## Verify Secret in Google Cloud

### Via gcloud CLI

```bash
# List all secrets
gcloud secrets list --project=tolstoy-staffing

# View secret metadata
gcloud secrets describe Mercury_Production --project=tolstoy-staffing

# Access secret value (for testing only - DO NOT log in production)
gcloud secrets versions access latest --secret=Mercury_Production --project=tolstoy-staffing
```

### Via Google Cloud Console

1. Go to: https://console.cloud.google.com/security/secret-manager
2. Select project: `tolstoy-staffing`
3. Find secret: `Mercury_Production`
4. Status should show: **Enabled**
5. Latest version should be: **Active**

---

## Permissions Required

### Service Account Permissions

Your application's service account needs:

```
roles/secretmanager.secretAccessor
```

**Applied to**:
- Secret: `Mercury_Production`
- Member: `<your-service-account>@tolstoy-staffing.iam.gserviceaccount.com`

### Grant Permissions

```bash
gcloud secrets add-iam-policy-binding Mercury_Production \
  --member="serviceAccount:<your-service-account>@tolstoy-staffing.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=tolstoy-staffing
```

---

## Testing Secret Access

### Test Script

Create `test-mercury-secret.ts`:

```typescript
import { getSecretValue } from './server/services/secretsManager';

async function testMercurySecret() {
  try {
    console.log('Testing Mercury_Production secret access...');
    
    const token = await getSecretValue('Mercury_Production');
    
    if (!token) {
      console.error('❌ Secret not found or empty');
      process.exit(1);
    }
    
    // Verify token format
    if (!token.startsWith('secret-token:mercury_production_wma_')) {
      console.error('❌ Invalid token format');
      process.exit(1);
    }
    
    // Show last 8 characters only (security)
    const tokenPreview = `...${token.slice(-8)}`;
    console.log(`✅ Mercury_Production secret loaded successfully: ${tokenPreview}`);
    
    // Test Mercury API connectivity
    const response = await fetch('https://api.mercury.com/v1/account', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (response.ok) {
      console.log('✅ Mercury API connection successful');
      const account = await response.json();
      console.log(`   Account ID: ${account.id}`);
      console.log(`   Balance: $${(account.availableBalance / 100).toFixed(2)}`);
    } else {
      console.error(`❌ Mercury API error: ${response.status} ${response.statusText}`);
    }
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testMercurySecret();
```

### Run Test

```bash
tsx test-mercury-secret.ts
```

Expected output:
```
Testing Mercury_Production secret access...
✅ Mercury_Production secret loaded successfully: ...yrucrem
✅ Mercury API connection successful
   Account ID: acc_xxxxxx
   Balance: $1,000.00
```

---

## Deployment Configuration

### Google Cloud Run (Production)

Ensure your `app.yaml` or deployment config includes:

```yaml
env_variables:
  NODE_ENV: production

# Secrets are automatically loaded by secretsManager.ts at runtime
# No need to explicitly configure here
```

### Docker (if applicable)

```dockerfile
# Secrets are loaded at runtime via Google Secrets Manager SDK
# No environment variables needed in Dockerfile
```

---

## Security Best Practices

### ✅ DO

- Store production tokens in Google Secrets Manager
- Use environment detection (dev vs prod)
- Log only token previews (last 8 chars)
- Rotate tokens every 90 days
- Use IAM for access control
- Enable audit logging

### ❌ DON'T

- Commit tokens to version control
- Log full tokens in production
- Share tokens via email/Slack
- Use production tokens in development
- Store tokens in code files
- Hard-code tokens anywhere

---

## Token Rotation Schedule

### Sandbox Token
- **Rotate**: Every 180 days or on compromise
- **Owner**: Development team
- **Process**: Generate new token → Update `.env.development` → Notify team

### Production Token
- **Rotate**: Every 90 days
- **Owner**: DevOps team
- **Process**: Generate new token → Update GCP Secret → Redeploy application

---

## Support

### If Secret Access Fails

1. **Check service account permissions**:
   ```bash
   gcloud secrets get-iam-policy Mercury_Production --project=tolstoy-staffing
   ```

2. **Verify secret exists**:
   ```bash
   gcloud secrets describe Mercury_Production --project=tolstoy-staffing
   ```

3. **Check application logs**:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND textPayload=~'Mercury'" --limit=50 --project=tolstoy-staffing
   ```

4. **Contact DevOps team** if issues persist

---

## Related Documentation

- **Migration Plan**: `MERCURY_BANK_MIGRATION.md`
- **API Tokens Doc**: `MERCURY_API_TOKENS.md`
- **Modern Treasury Archive**: `ARCHIVED_MODERN_TREASURY_INTEGRATION.md`
- **Environment Setup**: `ADD_TO_ENV_DEVELOPMENT.md`

---

**Setup By**: Development Team  
**Last Verified**: January 27, 2026  
**Status**: ✅ Production token configured, ready for use  
**Next Step**: Add sandbox token to `.env.development`

# Mercury API Tokens

**Setup Date**: January 27, 2026  
**Status**: ACTIVE - Replacing Modern Treasury  

---

## Production Token (Google Secrets Manager)

**Secret Name**: `Mercury_Production`  
**Token**: `<stored in GCP Secrets Manager — do not commit>`

### Storage Location
- **Google Cloud Secrets Manager**
- **Project**: tolstoy-staffing
- **Secret Version**: latest

### Access in Code
```typescript
import { getSecretValue } from './services/secretsManager';

const mercuryProductionToken = await getSecretValue('Mercury_Production');
```

---

## Sandbox Token (Environment Variable)

**Secret Name**: `Mercury_Sandbox`  
**Token**: `<add to .env.development — do not commit>`

### Storage Location
Add to `.env.development`:

```env
# Mercury Bank API - Sandbox
MERCURY_SANDBOX_API_TOKEN=<your-mercury-sandbox-token>
```

### Access in Code
```typescript
const mercurySandboxToken = process.env.MERCURY_SANDBOX_API_TOKEN;
```

---

## Environment Detection

```typescript
function getMercuryApiToken(): string {
  const isDev = process.env.NODE_ENV === "development";
  
  if (isDev) {
    // Use sandbox token in development
    const sandboxToken = process.env.MERCURY_SANDBOX_API_TOKEN;
    if (!sandboxToken) {
      throw new Error("MERCURY_SANDBOX_API_TOKEN not configured");
    }
    return sandboxToken;
  } else {
    // Use production token from Google Secrets Manager
    const productionToken = await getSecretValue('Mercury_Production');
    if (!productionToken) {
      throw new Error("Mercury_Production secret not found in Google Secrets Manager");
    }
    return productionToken;
  }
}
```

---

## Setup Instructions

### For Developers (Local Development)

1. **Add to your `.env.development` file**:
   ```env
   MERCURY_SANDBOX_API_TOKEN=<your-mercury-sandbox-token>
   ```

2. **Restart dev server**:
   ```bash
   npm run dev
   ```

3. **Verify in console**:
   ```
   [Mercury] Using SANDBOX API token
   ```

### For Production Deployment

1. **Already configured in Google Secrets Manager** ✅
   - Secret: `Mercury_Production`
   - Value: `secret-token:mercury_production_wma_...`

2. **Update `server/services/secretsManager.ts`** to include Mercury token access

3. **Deploy with secrets access**:
   ```bash
   # Secrets are automatically loaded from GCP Secrets Manager
   npm run build
   npm start
   ```

---

## Testing Tokens

### Sandbox Token Testing

Test the sandbox token works:

```bash
curl -H "Authorization: Bearer \$Mercury_Sandbox" \
  https://sandbox.mercury.com/api/v1/account
```

Expected response:
```json
{
  "id": "...",
  "name": "Sandbox Account",
  "balance": "..."
}
```

### Production Token Testing

**DO NOT test production token in development!**

Only use production token in production environment with proper safeguards.

---

## Security Notes

### Token Protection
- ✅ **Production token**: Stored in Google Secrets Manager (encrypted)
- ✅ **Sandbox token**: In `.env.development` (gitignored)
- ❌ **Never commit tokens** to version control
- ❌ **Never log full tokens** (only last 8 chars)
- ❌ **Never share tokens** via insecure channels

### Token Format
```
secret-token:mercury_{environment}_wma_{random_string}_yrucrem
              └─ prod/sandbox    └─ Mercury API key      └─ Checksum
```

### Token Permissions
Mercury tokens have access to:
- Read account information
- Create recipients (counterparties)
- Initiate payments
- View transaction history
- Manage bank accounts

### Rotation Policy
- **Sandbox**: Rotate quarterly or on suspected compromise
- **Production**: Rotate every 90 days or immediately on compromise

---

## Support & Documentation

### Mercury Bank Resources
- **API Documentation**: https://docs.mercury.com/
- **Sandbox Dashboard**: https://sandbox.mercury.com/
- **Production Dashboard**: https://mercury.com/
- **Support Email**: api-support@mercury.com

### Internal Resources
- Migration Guide: `MERCURY_BANK_MIGRATION.md`
- Service Implementation: `server/services/mercury.ts` (to be created)
- Archive: `ARCHIVED_MODERN_TREASURY_INTEGRATION.md`

---

## Emergency Procedures

### If Token is Compromised

1. **Immediately revoke** in Mercury dashboard
2. **Generate new token** in Mercury
3. **Update Google Secrets Manager** (production)
4. **Update `.env.development`** (sandbox)
5. **Redeploy application**
6. **Notify team**

### If Token Stops Working

1. Check Mercury dashboard for account status
2. Verify token hasn't expired
3. Check for rate limiting (429 errors)
4. Contact Mercury support
5. Generate new token if needed

---

## Next Steps

1. ✅ Tokens documented
2. ✅ Production token in Google Secrets Manager
3. [ ] Add sandbox token to `.env.development`
4. [ ] Implement Mercury service (`server/services/mercury.ts`)
5. [ ] Test Mercury API connectivity
6. [ ] Migrate payment processing flows

See `MERCURY_BANK_MIGRATION.md` for complete migration plan.

---

**Document Owner**: Development Team  
**Last Updated**: January 27, 2026  
**Status**: Active - Ready for implementation

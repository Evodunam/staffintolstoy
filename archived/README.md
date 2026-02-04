# Archived Code - Modern Treasury Integration

**Archive Date**: January 27, 2026  
**Reason**: Migrated to Mercury Bank for payment processing  

---

## Contents

This folder contains archived code from the Modern Treasury integration:

1. **`modernTreasury.service.ts`** - Complete Modern Treasury service implementation
   - Counterparty management
   - External account handling
   - ACH debit/credit operations
   - Virtual accounts & ledgers
   - Payment order tracking
   - 617 lines of integration code

2. **`auto-replenishment-scheduler.ts`** - Auto-replenishment scheduler with Modern Treasury
   - Balance monitoring
   - Automatic ACH debits
   - Company funding logic
   - 413 lines of scheduler code

---

## Why Archived?

We've migrated from **Modern Treasury** to **Mercury Bank** for:
- ✅ Simpler API
- ✅ Faster ACH processing
- ✅ Better developer experience
- ✅ Lower costs
- ✅ Direct banking integration

---

## Usage

### DO NOT use this code in production!

This code is archived for:
- ✅ Reference purposes
- ✅ Historical documentation
- ✅ Potential future use if needed
- ✅ Rollback scenario (emergency only)

### If You Need to Reference This Code

1. **Read the full integration**: `ARCHIVED_MODERN_TREASURY_INTEGRATION.md`
2. **Check migration guide**: `MERCURY_BANK_MIGRATION.md`
3. **Review archived files** in this folder

---

## Restoration (Emergency Only)

If Mercury integration fails and you need to rollback:

1. **Copy service back**:
   ```bash
   cp archived/modernTreasury.service.ts server/services/modernTreasury.ts
   cp archived/auto-replenishment-scheduler.ts server/auto-replenishment-scheduler.ts
   ```

2. **Reinstall dependency**:
   ```bash
   npm install modern-treasury
   ```

3. **Restore environment variables** (from Google Secrets Manager)

4. **Rollback database migrations**

5. **Revert code changes** via Git

---

## Files in This Folder

- `README.md` - This file
- `modernTreasury.service.ts` - Modern Treasury service (617 lines)
- `auto-replenishment-scheduler.ts` - Auto-replenishment with MT (413 lines)

---

## Related Documentation

- `../ARCHIVED_MODERN_TREASURY_INTEGRATION.md` - Complete integration documentation
- `../MERCURY_BANK_MIGRATION.md` - Migration plan to Mercury
- `../MERCURY_API_TOKENS.md` - Mercury API tokens

---

**Maintained By**: Tolstoy Staffing Development Team  
**Status**: ARCHIVED - Do not use  
**Last Updated**: January 27, 2026

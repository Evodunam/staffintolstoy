# 500KB Fix vs Database Migrations

**Summary:** The 500KB/Babel fix **did not run or require any database migration**. No tables or data were changed by that work. If something “removed a lot of things” or a migration failed, it was not caused by the 500KB fix.

---

## What the 500KB fix changed

- **Build only:** Switched from Babel to SWC in Vite (`@vitejs/plugin-react-swc`).
- **Files:** `vite.config.ts`, `package.json` (dependencies). No `server/`, `shared/schema`, or `migrations/` changes.
- **Database:** No migrations, no `db:push`, no schema changes. **No data was removed by this work.**

---

## The only DB migration in this repo

The single migration is:

- **`migrations/001_modern_treasury_to_mercury.sql`**
  - Renames Modern Treasury columns to Mercury names (e.g. `mt_counterparty_id` → `mercury_recipient_id`).
  - Drops some deprecated columns (`mt_virtual_account_id`, `mt_ledger_account_id`, `unit_*` where applicable).
  - **Important:** It renames columns so existing values are kept. It does not “delete” row data, only certain columns.

Nothing in the 500KB/Babel→SWC change runs or references this migration.

---

## Why it can look like “a failed migration removed a lot”

Two common cases:

1. **Running `db:push` when the DB still has old names**  
   - Schema already uses `mercury_*`. DB still has `mt_*`.  
   - `drizzle-kit push` can **drop** `mt_*` and **add** empty `mercury_*` columns.  
   - Result: values that lived in `mt_*` are lost. That looks like “a migration removed a lot,” but it was `db:push` aligning to the new schema without running the SQL migration first.

2. **Running the Mercury SQL migration in the wrong state**  
   - If the DB was created from the current schema (only `mercury_*`), the migration will fail with “column mt_counterparty_id does not exist.”  
   - If the migration was run twice, or run partway and then fixed by hand, the DB can end up in a half-updated state.

So any “removed a lot / failed migration” feeling is from **Mercury migration / `db:push` ordering**, not from the 500KB fix.

---

## Safe order (Mercury vs 500KB)

- **500KB fix:** No DB steps. No prior or later migration is required for it.
- **Mercury:**  
  1. If the DB still has `mt_*` (or `unit_*`) columns, run **`migrations/001_modern_treasury_to_mercury.sql`** first (e.g. via `psql` or your DB client).  
  2. **Do not** use `db:push` to “fix” schema mismatches when old columns hold data you care about. Use the SQL migration to rename columns and preserve data.  
  3. Use `db:push` only when the DB is either empty or already aligned with the current schema (e.g. after the SQL migration).

---

## If you think a migration failed or data was lost

1. **Confirm what the 500KB fix did:** Build/tooling only; no DB migration.
2. **Inspect the DB:** Check whether tables have `mt_*` or `mercury_*` column names (e.g. `profiles`, `company_payment_methods`, `company_transactions`, `worker_payouts`).
3. **Restore from backup** if you have one and need to recover data.
4. **Then run the Mercury migration once**, in order, and avoid `db:push` until the DB matches the intended state.

If you share whether the DB currently has `mt_*` or `mercury_*` (or a mix), we can outline the next exact steps (e.g. “run only this part of the migration” or “don’t run it, only fix code/schema”).

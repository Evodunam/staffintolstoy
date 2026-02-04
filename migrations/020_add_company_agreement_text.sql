-- Store full agreement content for company signed agreements (for display in company menu)
ALTER TABLE company_agreements ADD COLUMN IF NOT EXISTS agreement_text text;

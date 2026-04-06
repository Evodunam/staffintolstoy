-- Material invoice: workers can submit a receipt for materials; appears on company timesheets tagged as invoice with receipt
ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS timesheet_type text DEFAULT 'labor',
  ADD COLUMN IF NOT EXISTS receipt_url text;

COMMENT ON COLUMN timesheets.timesheet_type IS 'labor = clock in/out; material_invoice = worker-submitted receipt for materials';
COMMENT ON COLUMN timesheets.receipt_url IS 'Object path for receipt image (required for material_invoice)';

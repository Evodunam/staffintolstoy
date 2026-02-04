-- Allow affiliates to turn on the Sales tracker (kanban) without changing type
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS sales_tracker_enabled boolean DEFAULT false;

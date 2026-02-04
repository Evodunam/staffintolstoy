-- Add activity_list JSONB to affiliate_leads (replaces affiliate_lead_activities table)
ALTER TABLE affiliate_leads ADD COLUMN IF NOT EXISTS activity_list jsonb DEFAULT '[]';

-- Migrate existing activities into activity_list only if the old table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'affiliate_lead_activities') THEN
    UPDATE affiliate_leads al
    SET activity_list = (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('body', a.body, 'createdAt', a.created_at)
        ORDER BY a.created_at DESC
      ), '[]'::jsonb)
      FROM affiliate_lead_activities a
      WHERE a.lead_id = al.id
    )
    WHERE EXISTS (SELECT 1 FROM affiliate_lead_activities a WHERE a.lead_id = al.id);

    DROP TABLE affiliate_lead_activities;
  END IF;
END $$;

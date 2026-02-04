-- Add company_location_id to saved_team_members (team is per location)
ALTER TABLE saved_team_members
  ADD COLUMN IF NOT EXISTS company_location_id integer REFERENCES company_locations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_saved_team_location ON saved_team_members(company_location_id);

-- Replace old unique with partial uniques: one row per (company, worker) when location is null; one per (company, worker, location) when location set
DROP INDEX IF EXISTS idx_saved_team_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_team_unique_null
  ON saved_team_members(company_id, worker_id) WHERE company_location_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_team_unique_location
  ON saved_team_members(company_id, worker_id, company_location_id) WHERE company_location_id IS NOT NULL;

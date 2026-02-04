-- Migration: Add job_position to team_invites for job title (e.g. "Project Manager")

ALTER TABLE team_invites
  ADD COLUMN IF NOT EXISTS job_position TEXT;

COMMENT ON COLUMN team_invites.job_position IS 'Job title/position (e.g. Project Manager, Foreman)';

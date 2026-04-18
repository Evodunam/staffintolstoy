-- Time-clock selfie capture URLs + match scores. Combats buddy-punching.
-- match_score is a 0.0–1.0 cosine similarity returned by face-match service
-- (AWS Rekognition CompareFaces, Persona, or similar). Below ~0.85 is suspect.

ALTER TABLE timesheets
  ADD COLUMN IF NOT EXISTS clock_in_selfie_url TEXT,
  ADD COLUMN IF NOT EXISTS clock_out_selfie_url TEXT,
  ADD COLUMN IF NOT EXISTS clock_in_selfie_match_score NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS clock_out_selfie_match_score NUMERIC(4,3);

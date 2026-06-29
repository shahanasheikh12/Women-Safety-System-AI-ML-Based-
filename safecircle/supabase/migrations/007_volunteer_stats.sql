-- ============================================================
-- SafeCircle — Migration 007
-- Volunteer Stats Table & Security Rules
-- ============================================================

-- Create the volunteer_stats table to store summarized performance metrics
CREATE TABLE IF NOT EXISTS volunteer_stats (
  volunteer_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_notified INT DEFAULT 0,
  total_accepted INT DEFAULT 0,
  total_completed INT DEFAULT 0,
  total_declined INT DEFAULT 0,
  total_false_reports INT DEFAULT 0,
  avg_rating FLOAT DEFAULT 5.0,
  avg_response_time_seconds INT DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Index to optimize lookups on volunteer stats
CREATE INDEX IF NOT EXISTS idx_volunteer_stats_volunteer_id 
  ON volunteer_stats(volunteer_id);

-- Enable Row Level Security
ALTER TABLE volunteer_stats ENABLE ROW LEVEL SECURITY;

-- Allow volunteers to read their own stats
CREATE POLICY "Volunteers can view own stats"
  ON volunteer_stats FOR SELECT
  TO authenticated
  USING (auth.uid() = volunteer_id);

-- Allow service role (FastAPI backend and Edge Functions) full write access
CREATE POLICY "Service role full access on stats"
  ON volunteer_stats FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Enable a trigger to automatically update last_updated timestamp
CREATE OR REPLACE FUNCTION update_last_updated_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.last_updated = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_volunteer_stats_timestamp
BEFORE UPDATE ON volunteer_stats
FOR EACH ROW
EXECUTE FUNCTION update_last_updated_column();

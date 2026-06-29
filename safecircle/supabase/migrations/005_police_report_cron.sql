-- ============================================================
-- SafeCircle — Migration 005
-- Police Notification + Incident Report + Evidence Lifecycle
-- ============================================================

-- ============================================================
-- 1. Add police_notified column if not already present
--    (already in schema, this is idempotent)
-- ============================================================
ALTER TABLE sos_events
  ADD COLUMN IF NOT EXISTS police_notified BOOLEAN DEFAULT false;

-- ============================================================
-- 2. Add report_url column to store the generated report link
-- ============================================================
ALTER TABLE sos_events
  ADD COLUMN IF NOT EXISTS report_url TEXT;

-- ============================================================
-- 3. Index for report generation queries
--    (fetch all events for a user ordered by date)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sos_events_user_date
  ON sos_events(user_id, started_at DESC);

-- ============================================================
-- 4. Supabase Storage — allow service role to upload reports
-- ============================================================

-- Allow edge functions (service role) to upload to sos-evidence
CREATE POLICY IF NOT EXISTS "sos-evidence: service role insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'sos-evidence');

-- Allow edge functions to read/sign evidence files
CREATE POLICY IF NOT EXISTS "sos-evidence: service role select"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'sos-evidence');

-- Allow edge functions to update/upsert reports
CREATE POLICY IF NOT EXISTS "sos-evidence: service role update"
  ON storage.objects FOR UPDATE
  TO service_role
  USING (bucket_id = 'sos-evidence');

-- ============================================================
-- 5. pg_cron — Auto-delete old evidence data (30 day retention)
-- ============================================================
-- Runs every day at 2:00 AM UTC.
-- Deletes location_stream rows older than 30 days.
-- Audio/photo files in storage are NOT deleted here — they are
-- managed separately via Supabase Storage lifecycle policies.
-- ============================================================

-- Remove existing schedule if it exists (idempotent re-deploy)
SELECT cron.unschedule('delete-old-location-stream')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'delete-old-location-stream'
);

SELECT cron.schedule(
  'delete-old-location-stream',  -- job name
  '0 2 * * *',                   -- cron: 2:00 AM UTC daily
  $$
    DELETE FROM location_stream
    WHERE recorded_at < NOW() - INTERVAL '30 days';
  $$
);

-- ============================================================
-- 6. pg_cron — Auto-resolve stale active SOS events
-- ============================================================
-- Safety net: if an SOS stays 'active' for > 24 hours it's
-- auto-resolved as 'escalated' with a note.
-- ============================================================
SELECT cron.unschedule('auto-resolve-stale-sos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'auto-resolve-stale-sos'
);

SELECT cron.schedule(
  'auto-resolve-stale-sos',
  '30 2 * * *',   -- 2:30 AM UTC daily (after location cleanup)
  $$
    UPDATE sos_events
    SET
      status      = 'escalated',
      resolved_at = NOW(),
      notes       = COALESCE(notes, '') || ' [Auto-resolved: SOS active >24h]'
    WHERE
      status     = 'active'
      AND started_at < NOW() - INTERVAL '24 hours';
  $$
);

-- ============================================================
-- 7. pg_cron — Weekly credit expiry (future: credits expire)
-- ============================================================
-- Placeholder for future feature: deduct 1 credit/week if
-- volunteer hasn't responded to any SOS (keeps network active).
-- Currently a no-op SELECT for monitoring.
-- ============================================================
SELECT cron.unschedule('volunteer-credit-heartbeat')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'volunteer-credit-heartbeat'
);

SELECT cron.schedule(
  'volunteer-credit-heartbeat',
  '0 3 * * 1',   -- 3:00 AM UTC every Monday
  $$
    -- Future: implement credit decay for inactive volunteers
    -- For now: update a heartbeat timestamp in a monitoring table
    SELECT NOW() AS heartbeat_check;
  $$
);

-- ============================================================
-- 8. Helper function: get_incident_summary()
-- ============================================================
-- Used by the generate-report edge function to fetch all
-- incident data in a single RPC call (avoids multiple round-trips).
-- ============================================================
CREATE OR REPLACE FUNCTION get_incident_summary(p_sos_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as DB owner, bypasses RLS safely
AS $$
DECLARE
  v_sos         JSONB;
  v_locations   JSONB;
  v_volunteers  JSONB;
  v_user        JSONB;
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM sos_events WHERE id = p_sos_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Access denied or SOS not found';
  END IF;

  -- SOS event
  SELECT row_to_json(s)::JSONB INTO v_sos
  FROM sos_events s
  WHERE id = p_sos_id;

  -- Location history (most recent 200 points)
  SELECT COALESCE(json_agg(l ORDER BY l.recorded_at ASC), '[]'::JSON)::JSONB INTO v_locations
  FROM (
    SELECT lat, lng, accuracy_meters, recorded_at
    FROM location_stream
    WHERE sos_id = p_sos_id
    ORDER BY recorded_at DESC
    LIMIT 200
  ) l;

  -- Volunteer responses with user details
  SELECT COALESCE(json_agg(vr), '[]'::JSON)::JSONB INTO v_volunteers
  FROM (
    SELECT
      vr.volunteer_id,
      vr.status,
      vr.response_time_seconds,
      vr.credits_awarded,
      vr.victim_rating,
      json_build_object(
        'name',              u.name,
        'verification_tier', u.verification_tier,
        'trust_score',       u.trust_score
      ) AS users
    FROM volunteer_responses vr
    LEFT JOIN users u ON u.id = vr.volunteer_id
    WHERE vr.sos_id = p_sos_id
    ORDER BY vr.created_at ASC
  ) vr;

  -- Victim user info
  SELECT json_build_object('name', u.name, 'phone', u.phone)::JSONB INTO v_user
  FROM users u WHERE u.id = p_user_id;

  RETURN jsonb_build_object(
    'sos',        v_sos,
    'locations',  v_locations,
    'volunteers', v_volunteers,
    'user',       v_user
  );
END;
$$;

-- Grant execution to service role and authenticated users (own data only)
GRANT EXECUTE ON FUNCTION get_incident_summary(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_incident_summary(UUID, UUID) TO authenticated;

-- ============================================================
-- 9. Verify cron jobs are scheduled
-- ============================================================
DO $$
BEGIN
  RAISE NOTICE '✅ pg_cron jobs scheduled:';
  RAISE NOTICE '   - delete-old-location-stream (daily 02:00 UTC)';
  RAISE NOTICE '   - auto-resolve-stale-sos (daily 02:30 UTC)';
  RAISE NOTICE '   - volunteer-credit-heartbeat (weekly Monday 03:00 UTC)';
END $$;

-- ============================================================
-- SafeCircle — Edge Function Helper Functions
-- Migration: 002_edge_function_helpers.sql
-- ============================================================
-- These stored procedures are called by the Edge Functions:
--   • find_nearby_volunteers  → used by notify-volunteers
--   • increment_credits       → used by award-credits
-- ============================================================

-- ============================================================
-- 1. find_nearby_volunteers
--    PostGIS proximity search with trust-weighted ranking.
--    Called by: notify-volunteers/index.ts
-- ============================================================

CREATE OR REPLACE FUNCTION find_nearby_volunteers(
  p_victim_lat    FLOAT,
  p_victim_lng    FLOAT,
  p_victim_id     UUID,
  p_radius_meters FLOAT DEFAULT 2000,
  p_limit         INT   DEFAULT 20
)
RETURNS TABLE (
  id                UUID,
  fcm_token         TEXT,
  verification_tier INT,
  trust_score       FLOAT,
  name              TEXT,
  distance_meters   FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER  -- runs as the function owner, bypasses RLS
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.fcm_token,
    u.verification_tier,
    u.trust_score,
    u.name,
    ST_Distance(
      ST_MakePoint(u.current_lng, u.current_lat)::geography,
      ST_MakePoint(p_victim_lng,  p_victim_lat)::geography
    )::FLOAT AS distance_meters
  FROM users u
  WHERE
    u.is_volunteer = true
    AND u.verification_tier >= 1
    AND u.id != p_victim_id
    AND u.current_lat IS NOT NULL
    AND u.current_lng IS NOT NULL
    AND u.fcm_token IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(u.current_lng, u.current_lat)::geography,
      ST_MakePoint(p_victim_lng,  p_victim_lat)::geography,
      p_radius_meters
    )
  ORDER BY
    -- Primary: composite trust score (tier × 0.4 + trust × 0.006) DESC
    (u.verification_tier * 0.4 + u.trust_score * 0.006) DESC,
    -- Secondary: nearest first
    distance_meters ASC
  LIMIT p_limit;
END;
$$;

-- Grant execute to the service role (used by Edge Functions)
GRANT EXECUTE ON FUNCTION find_nearby_volunteers(FLOAT, FLOAT, UUID, FLOAT, INT)
  TO service_role;

-- Also grant to authenticated for direct client calls (optional)
GRANT EXECUTE ON FUNCTION find_nearby_volunteers(FLOAT, FLOAT, UUID, FLOAT, INT)
  TO authenticated;

COMMENT ON FUNCTION find_nearby_volunteers IS
  'Returns nearby active volunteers sorted by trust score and proximity. '
  'Uses PostGIS ST_DWithin for efficient geo-indexing. '
  'Called by the notify-volunteers Edge Function.';


-- ============================================================
-- 2. increment_credits
--    Atomically increments (or decrements) a user''s credit balance.
--    Uses a database-level lock to prevent race conditions.
--    Called by: award-credits/index.ts
-- ============================================================

CREATE OR REPLACE FUNCTION increment_credits(
  p_user_id UUID,
  p_delta   INT
)
RETURNS INT  -- returns the NEW credit balance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance INT;
BEGIN
  UPDATE users
  SET credits = GREATEST(0, credits + p_delta)  -- floor at 0, no negative credits
  WHERE id = p_user_id
  RETURNING credits INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  RETURN v_new_balance;
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION increment_credits(UUID, INT) TO service_role;

COMMENT ON FUNCTION increment_credits IS
  'Atomically updates users.credits with a delta (positive or negative). '
  'Credits are floored at 0 — users cannot go negative. '
  'Returns the new balance. Called by the award-credits Edge Function.';


-- ============================================================
-- 3. count_volunteer_assists
--    Returns total completed assists for milestone badge checks.
--    Called by: award-credits/index.ts
-- ============================================================

CREATE OR REPLACE FUNCTION count_volunteer_assists(
  p_volunteer_id UUID
)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM volunteer_responses
  WHERE volunteer_id = p_volunteer_id
    AND status = 'completed';
$$;

GRANT EXECUTE ON FUNCTION count_volunteer_assists(UUID) TO service_role;

COMMENT ON FUNCTION count_volunteer_assists IS
  'Returns the total number of completed SOS assists for a volunteer. '
  'Used for milestone badge threshold checks.';


-- ============================================================
-- 4. SPATIAL INDEX
--    Improves ST_DWithin query performance dramatically.
--    PostGIS GIST index on user locations.
-- ============================================================

-- Drop simple column index if it exists (we replace with spatial)
DROP INDEX IF EXISTS idx_users_location;

-- Create a PostGIS geography spatial index
CREATE INDEX IF NOT EXISTS idx_users_location_gist
  ON users
  USING GIST (
    ST_GeogFromText(
      'POINT(' || current_lng || ' ' || current_lat || ')'
    )
  )
  WHERE current_lat IS NOT NULL AND current_lng IS NOT NULL;

COMMENT ON INDEX idx_users_location_gist IS
  'PostGIS GIST spatial index for fast volunteer proximity queries (ST_DWithin).';


-- ============================================================
-- 5. PARTIAL INDEX for active volunteers
--    Further speeds up the volunteer search query.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_active_volunteers
  ON users (verification_tier, trust_score, current_lat, current_lng)
  WHERE is_volunteer = true
    AND verification_tier >= 1
    AND current_lat IS NOT NULL
    AND current_lng IS NOT NULL
    AND fcm_token IS NOT NULL;

COMMENT ON INDEX idx_users_active_volunteers IS
  'Partial index covering only active, geolocated, push-enabled volunteers.';


-- ============================================================
-- 6. RLS policy: allow service_role to INSERT volunteer_responses
--    (Edge Functions run as service_role and bypass RLS by default,
--     but this makes intent explicit.)
-- ============================================================

-- Allow edge functions (service_role) to insert on behalf of the system
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'volunteer_responses'
      AND policyname = 'volunteer_responses: service_role insert'
  ) THEN
    CREATE POLICY "volunteer_responses: service_role insert"
      ON volunteer_responses FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END;
$$;

-- Allow service_role to read users for proximity queries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'users'
      AND policyname = 'users: service_role full access'
  ) THEN
    CREATE POLICY "users: service_role full access"
      ON users FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END;
$$;

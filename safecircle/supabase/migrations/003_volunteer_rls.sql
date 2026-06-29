-- ============================================================
-- SafeCircle — Volunteer/Victim SELECT policy
-- Migration: 003_volunteer_rls.sql
-- ============================================================

-- Drop the overly restrictive select policy if it exists
DROP POLICY IF EXISTS "users: select own row" ON users;

-- Create the new profile selection policy
CREATE POLICY "users: select own or volunteer or connected"
  ON users FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR is_volunteer = true
    OR EXISTS (
      SELECT 1 FROM volunteer_responses vr
      WHERE vr.volunteer_id = users.id AND vr.sos_id IN (
        SELECT id FROM sos_events WHERE user_id = auth.uid()
      )
    )
    OR EXISTS (
      SELECT 1 FROM sos_events se
      WHERE se.user_id = users.id AND se.id IN (
        SELECT sos_id FROM volunteer_responses WHERE volunteer_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY "users: select own or volunteer or connected" ON users IS
  'Allows authenticated users to view their own profile, profiles of any registered volunteer, '
  'and profiles of victims/responders actively connected via an emergency event.';

-- ============================================================
-- SafeCircle — User Settings Schema
-- Migration: 004_user_settings.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sos_countdown_seconds          INT DEFAULT 3 CHECK (sos_countdown_seconds IN (3, 5, 10)),
  sos_shake_sensitivity          TEXT DEFAULT 'Medium' CHECK (sos_shake_sensitivity IN ('Low', 'Medium', 'High')),
  sos_silent_by_default          BOOLEAN DEFAULT false,
  sos_voice_hotword_enabled      BOOLEAN DEFAULT false,
  sos_power_button_enabled        BOOLEAN DEFAULT false,
  share_location_with_volunteers BOOLEAN DEFAULT true,
  share_location_with_contacts   BOOLEAN DEFAULT true,
  location_accuracy              TEXT DEFAULT 'High' CHECK (location_accuracy IN ('High', 'Balanced', 'Low')),
  receive_alerts                 BOOLEAN DEFAULT true,
  alert_radius_km                FLOAT DEFAULT 2.0,
  available_hours_start          TEXT DEFAULT '00:00',
  available_hours_end            TEXT DEFAULT '23:59',
  do_not_disturb                 BOOLEAN DEFAULT false,
  auto_delete_evidence_days      INT DEFAULT 30,
  biometric_lock_enabled         BOOLEAN DEFAULT false,
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "user_settings: select own row" ON user_settings;
DROP POLICY IF EXISTS "user_settings: insert own row" ON user_settings;
DROP POLICY IF EXISTS "user_settings: update own row" ON user_settings;

-- Create Policies
CREATE POLICY "user_settings: select own row"
  ON user_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_settings: insert own row"
  ON user_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_settings: update own row"
  ON user_settings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE user_settings IS 'Stores customization options and alert configuration settings for each user.';

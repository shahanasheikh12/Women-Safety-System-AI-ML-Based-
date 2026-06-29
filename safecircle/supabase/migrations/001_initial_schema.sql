-- ============================================================
-- SafeCircle — Initial Database Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ============================================================
-- 2. TABLES
-- ============================================================

-- Users table
CREATE TABLE users (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone                TEXT UNIQUE NOT NULL,
  name                 TEXT,
  gender               TEXT CHECK (gender IN ('female', 'male', 'other')),
  is_volunteer         BOOLEAN DEFAULT false,
  verification_tier    INT DEFAULT 0 CHECK (verification_tier BETWEEN 0 AND 3),
  trust_score          FLOAT DEFAULT 50.0,
  credits              INT DEFAULT 0,
  fcm_token            TEXT,
  current_lat          FLOAT,
  current_lng          FLOAT,
  location_updated_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- SOS Events table
CREATE TABLE sos_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active','resolved','false_alarm','escalated')),
  trigger_method   TEXT CHECK (trigger_method IN ('button','voice','shake','accelerometer','power_button')),
  lat              FLOAT NOT NULL,
  lng              FLOAT NOT NULL,
  audio_url        TEXT,
  photo_url        TEXT,
  police_notified  BOOLEAN DEFAULT false,
  notes            TEXT,
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

-- Location Stream (real-time location during SOS)
CREATE TABLE location_stream (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sos_id           UUID REFERENCES sos_events(id) ON DELETE CASCADE NOT NULL,
  lat              FLOAT NOT NULL,
  lng              FLOAT NOT NULL,
  accuracy_meters  FLOAT,
  recorded_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Volunteer Responses
CREATE TABLE volunteer_responses (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sos_id                 UUID REFERENCES sos_events(id) ON DELETE CASCADE NOT NULL,
  volunteer_id           UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  status                 TEXT DEFAULT 'notified' CHECK (status IN ('notified','accepted','en_route','arrived','declined','completed')),
  response_time_seconds  INT,
  victim_rating          INT CHECK (victim_rating BETWEEN 1 AND 5),
  credits_awarded        INT DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- Emergency Contacts
CREATE TABLE emergency_contacts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  relationship    TEXT,
  notify_on_sos   BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Threat Zones (ML output from DBSCAN)
CREATE TABLE threat_zones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cluster_id      INT,
  geojson         JSONB,
  risk_level      TEXT CHECK (risk_level IN ('low','medium','high','critical')),
  incident_count  INT DEFAULT 0,
  center_lat      FLOAT,
  center_lng      FLOAT,
  last_updated    TIMESTAMPTZ DEFAULT NOW()
);

-- Credit Transactions (audit log)
CREATE TABLE credit_transactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  amount      INT NOT NULL,
  reason      TEXT,
  sos_id      UUID REFERENCES sos_events(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- Geo-proximity queries for volunteer matching
CREATE INDEX idx_users_location ON users(current_lat, current_lng);

-- SOS event lookups
CREATE INDEX idx_sos_events_user_status ON sos_events(user_id, status);
CREATE INDEX idx_sos_events_started_at  ON sos_events(started_at DESC);

-- Real-time location stream playback
CREATE INDEX idx_location_stream_sos_time ON location_stream(sos_id, recorded_at DESC);

-- Volunteer response lookups
CREATE INDEX idx_volunteer_responses_sos       ON volunteer_responses(sos_id);
CREATE INDEX idx_volunteer_responses_volunteer ON volunteer_responses(volunteer_id);
CREATE INDEX idx_volunteer_responses_compound  ON volunteer_responses(sos_id, volunteer_id);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sos_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_stream     ENABLE ROW LEVEL SECURITY;
ALTER TABLE volunteer_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE threat_zones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------
-- users policies
-- ----------------------------------------------------------------
CREATE POLICY "users: select own row"
  ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "users: update own row"
  ON users FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "users: insert own row"
  ON users FOR INSERT
  WITH CHECK (id = auth.uid());

-- ----------------------------------------------------------------
-- sos_events policies
-- ----------------------------------------------------------------
CREATE POLICY "sos_events: select own events"
  ON sos_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "sos_events: insert own events"
  ON sos_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "sos_events: update own events"
  ON sos_events FOR UPDATE
  USING (user_id = auth.uid());

-- ----------------------------------------------------------------
-- location_stream policies
-- ----------------------------------------------------------------
-- Victim can always see their own stream; accepted volunteers can also see it
CREATE POLICY "location_stream: select victim or accepted volunteer"
  ON location_stream FOR SELECT
  USING (
    -- User is the SOS victim
    EXISTS (
      SELECT 1 FROM sos_events se
      WHERE se.id = location_stream.sos_id
        AND se.user_id = auth.uid()
    )
    OR
    -- User is a volunteer who accepted this SOS
    EXISTS (
      SELECT 1 FROM volunteer_responses vr
      WHERE vr.sos_id = location_stream.sos_id
        AND vr.volunteer_id = auth.uid()
        AND vr.status IN ('accepted','en_route','arrived','completed')
    )
  );

CREATE POLICY "location_stream: insert own stream"
  ON location_stream FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sos_events se
      WHERE se.id = location_stream.sos_id
        AND se.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------
-- emergency_contacts policies
-- ----------------------------------------------------------------
CREATE POLICY "emergency_contacts: full crud own contacts"
  ON emergency_contacts FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ----------------------------------------------------------------
-- volunteer_responses policies
-- ----------------------------------------------------------------
CREATE POLICY "volunteer_responses: select volunteer or sos owner"
  ON volunteer_responses FOR SELECT
  USING (
    volunteer_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM sos_events se
      WHERE se.id = volunteer_responses.sos_id
        AND se.user_id = auth.uid()
    )
  );

CREATE POLICY "volunteer_responses: insert own response"
  ON volunteer_responses FOR INSERT
  WITH CHECK (volunteer_id = auth.uid());

CREATE POLICY "volunteer_responses: update own response"
  ON volunteer_responses FOR UPDATE
  USING (volunteer_id = auth.uid());

-- ----------------------------------------------------------------
-- threat_zones policies (public read)
-- ----------------------------------------------------------------
CREATE POLICY "threat_zones: public select"
  ON threat_zones FOR SELECT
  USING (true);

-- ----------------------------------------------------------------
-- credit_transactions policies
-- ----------------------------------------------------------------
CREATE POLICY "credit_transactions: select own"
  ON credit_transactions FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- 5. REALTIME PUBLICATION
-- ============================================================

-- Supabase uses the supabase_realtime publication by default.
-- Add the tables that need live updates.

ALTER PUBLICATION supabase_realtime ADD TABLE location_stream;
ALTER PUBLICATION supabase_realtime ADD TABLE sos_events;
ALTER PUBLICATION supabase_realtime ADD TABLE volunteer_responses;

-- ============================================================
-- 6. STORAGE BUCKET
-- ============================================================

-- Create private bucket for SOS audio, photos, and documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sos-evidence',
  'sos-evidence',
  false,                                              -- private bucket (auth required)
  52428800,                                           -- 50MB limit in bytes
  ARRAY['audio/*', 'image/*', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: only the authenticated owner can upload evidence
CREATE POLICY "sos-evidence: authenticated upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'sos-evidence');

-- Storage RLS: user can only read their own evidence
CREATE POLICY "sos-evidence: owner read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'sos-evidence'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage RLS: user can delete their own evidence
CREATE POLICY "sos-evidence: owner delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'sos-evidence'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

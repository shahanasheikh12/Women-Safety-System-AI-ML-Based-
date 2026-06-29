-- ============================================================
-- SafeCircle — Migration 008
-- Supabase pg_cron & Webhook Schedules
-- ============================================================

-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Cleanup existing duplicate jobs if any
SELECT cron.unschedule('retrain-heatmap') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retrain-heatmap');
SELECT cron.unschedule('retrain-trust-scores') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retrain-trust-scores');
SELECT cron.unschedule('cleanup-location-stream') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-location-stream');
SELECT cron.unschedule('escalate-unresolved-sos') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'escalate-unresolved-sos');
SELECT cron.unschedule('clear-stale-volunteer-locations') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clear-stale-volunteer-locations');

-- 1. Nightly heatmap retrain (2 AM every day)
SELECT cron.schedule(
  'retrain-heatmap',
  '0 2 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.ml_api_url') || '/ml/heatmap/retrain',
    headers := ('{"X-Cron-Secret": "' || current_setting('app.cron_secret') || '", "Content-Type": "application/json"}')::jsonb,
    body := '{}'::jsonb
  )$$
);

-- 2. Weekly trust score retrain (Sunday 3 AM)
SELECT cron.schedule(
  'retrain-trust-scores',
  '0 3 * * 0',
  $$SELECT net.http_post(
    url := current_setting('app.ml_api_url') || '/ml/trust/retrain',
    headers := ('{"X-Cron-Secret": "' || current_setting('app.cron_secret') || '", "Content-Type": "application/json"}')::jsonb,
    body := '{}'::jsonb
  )$$
);

-- 3. Delete old location stream data (daily at 4 AM, keep 30 days)
SELECT cron.schedule(
  'cleanup-location-stream',
  '0 4 * * *',
  $$DELETE FROM location_stream WHERE recorded_at < NOW() - INTERVAL '30 days'$$
);

-- 4. Auto-escalate unresolved SOS after 30 minutes (every 5 minutes)
SELECT cron.schedule(
  'escalate-unresolved-sos',
  '*/5 * * * *',
  $$UPDATE sos_events 
    SET status = 'escalated' 
    WHERE status = 'active' 
    AND started_at < NOW() - INTERVAL '30 minutes'$$
);

-- 5. Update volunteer location staleness (every 10 minutes)
SELECT cron.schedule(
  'clear-stale-volunteer-locations',
  '*/10 * * * *',
  $$UPDATE users 
    SET current_lat = NULL, current_lng = NULL 
    WHERE location_updated_at < NOW() - INTERVAL '10 minutes'
    AND is_volunteer = true$$
);

-- Set configuration parameters (change 'your_secret_key_here' to your real env key in prod)
ALTER DATABASE postgres SET app.ml_api_url = 'https://safecircle-ml-api.onrender.com';
ALTER DATABASE postgres SET app.cron_secret = 'super-secret-cron-key';

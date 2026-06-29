-- ============================================================
-- SafeCircle — Migration 006
-- Machine Learning Microservices Scheduling (pg_cron)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Threat Zone Heatmap Auto-Retraining (Daily at 2:00 AM UTC)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('update-heatmap')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'update-heatmap'
);

SELECT cron.schedule(
  'update-heatmap',   -- job name
  '0 2 * * *',        -- cron: 2:00 AM UTC daily
  $$
    -- Note: Replace 'safecircle-ml-api.onrender.com' with your actual Render deployment domain if modified
    SELECT net.http_post(
      url := 'https://safecircle-ml-api.onrender.com/ml/heatmap/retrain',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 2. Volunteer Trust Scores Auto-Retraining (Sundays at 3:00 AM UTC)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('update-trust-scores')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'update-trust-scores'
);

SELECT cron.schedule(
  'update-trust-scores',  -- job name
  '0 3 * * 0',            -- cron: 3:00 AM UTC every Sunday
  $$
    -- Note: Replace 'safecircle-ml-api.onrender.com' with your actual Render deployment domain if modified
    SELECT net.http_post(
      url := 'https://safecircle-ml-api.onrender.com/ml/trust/retrain',
      body := '{}'::jsonb,
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  $$
);

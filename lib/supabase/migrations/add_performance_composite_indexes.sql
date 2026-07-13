-- Performance composite indexes for jobs list, notifications, and scheduler chunk fetches.
--
-- OFF-PEAK ROLLOUT REQUIRED — see docs/SUPABASE_RESOURCE_MONITORING.md
--   - Run during low-traffic windows (evenings/weekends, Singapore time)
--   - One CREATE INDEX CONCURRENTLY per statement (not in a transaction block)
--   - Pause 5–15 minutes between batches; monitor CPU, connections, and API errors
--   - Wait for each build to finish (pg_stat_progress_create_index) before the next
--   - After all indexes: ANALYZE jobs, notifications, technician_jobs, job_schedule, customer_location

-- 1) Jobs list default browse: filter scheduled_start, sort created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_active_sched_start_created_at
  ON public.jobs (scheduled_start, created_at DESC)
  WHERE deleted_at IS NULL;

-- 2) Scheduler overlap + range scans on scheduled window
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_active_sched_end_start
  ON public.jobs (scheduled_end, scheduled_start)
  WHERE deleted_at IS NULL AND scheduled_start IS NOT NULL;

-- 3) Undated jobs bucket in scheduler
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_active_undated_created_at
  ON public.jobs (created_at DESC)
  WHERE deleted_at IS NULL AND scheduled_start IS NULL;

-- 4) Notifications list + mark-read (worker_id is the real user key)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_worker_hidden_created_at
  ON public.notifications (worker_id, hidden, created_at DESC);

-- Partial index for broadcast notifications (worker_id IS NULL)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_broadcast_hidden_created_at
  ON public.notifications (created_at DESC)
  WHERE hidden = false AND worker_id IS NULL;

-- 5) Mark-read hot path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_worker_hidden_read
  ON public.notifications (worker_id, hidden, read)
  WHERE hidden = false;

-- 6) Scheduler chunk fetches (reinforce existing single-column indexes)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_technician_jobs_job_id_active
  ON public.technician_jobs (job_id)
  WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_schedule_job_id_jsdate
  ON public.job_schedule (job_id, jsdate);

-- customer_location already has idx_customer_location_customer_id;
-- covering index if planner still seq-scans at scale:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_location_customer_id_id
  ON public.customer_location (customer_id, id);

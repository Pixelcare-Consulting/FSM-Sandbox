-- pg_trgm indexes for jobs list global search (job number, title, description, schedule address).
-- Apply via Supabase SQL editor or migration pipeline.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_jobs_job_number_trgm
  ON public.jobs USING gin (job_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
  ON public.jobs USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_jobs_description_trgm
  ON public.jobs USING gin (description gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_job_schedule_address_trgm
  ON public.job_schedule USING gin (address gin_trgm_ops);

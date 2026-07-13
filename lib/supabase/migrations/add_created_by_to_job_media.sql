-- Migration: Add created_by to job_media (repo sync; production may already have column)
-- Tracks who uploaded or generated job media (images, PDFs).

ALTER TABLE job_media
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill existing rows from jobs.created_by where possible
UPDATE job_media jm
SET created_by = j.created_by
FROM jobs j
WHERE jm.job_id = j.id
  AND jm.created_by IS NULL
  AND j.created_by IS NOT NULL;

-- Enforce NOT NULL only when no active rows lack created_by
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM job_media WHERE created_by IS NULL AND deleted_at IS NULL
  ) THEN
    ALTER TABLE job_media ALTER COLUMN created_by SET NOT NULL;
  ELSE
    RAISE NOTICE 'job_media.created_by still has NULL rows; NOT NULL constraint not applied';
  END IF;
END $$;

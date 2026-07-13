-- Mobile field app can POST task names longer than varchar(255), causing 400 errors.
-- Widen task_name to TEXT (task_description is already TEXT).

ALTER TABLE job_tasks
  ALTER COLUMN task_name TYPE TEXT;

COMMENT ON COLUMN job_tasks.task_name IS
  'Task label from portal or mobile; widened from varchar(255) to TEXT for long mobile entries.';

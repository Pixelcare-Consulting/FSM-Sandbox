/** @deprecated varchar(255) limit removed in widen_job_tasks_task_name_to_text migration */
export const JOB_TASK_NAME_MAX_LENGTH = 2000;

/**
 * Normalize task_name before portal inserts (defense in depth).
 * @param {unknown} name
 */
export function normalizeJobTaskNameForInsert(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Task';
  if (trimmed.length <= JOB_TASK_NAME_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, JOB_TASK_NAME_MAX_LENGTH);
}

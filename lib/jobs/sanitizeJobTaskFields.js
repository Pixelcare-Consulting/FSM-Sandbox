const TASK_NAME_MAX_LENGTH = 255;

/**
 * Mobile/portal inserts must keep task_name within VARCHAR(255).
 * Long text is moved to task_description when possible.
 */
export function sanitizeJobTaskFields({ taskName, taskDescription } = {}) {
  let name = String(taskName ?? '').trim();
  let description = String(taskDescription ?? '').trim();

  if (name.length <= TASK_NAME_MAX_LENGTH) {
    return { task_name: name, task_description: description };
  }

  const overflow = name.slice(TASK_NAME_MAX_LENGTH);
  name = name.slice(0, TASK_NAME_MAX_LENGTH).trimEnd();
  description = description ? `${description}\n${overflow}` : overflow;

  return { task_name: name, task_description: description };
}

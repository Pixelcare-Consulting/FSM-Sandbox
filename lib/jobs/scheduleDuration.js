/**
 * Parse job_schedule.dur (decimal hours) into form hours + minutes.
 */
export function parseDurationHoursToForm(durDecimal) {
  if (durDecimal == null || durDecimal === '') {
    return { hours: '', minutes: '' };
  }
  const parsed = parseFloat(durDecimal);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return { hours: '', minutes: '' };
  }
  const hours = Math.floor(parsed);
  const minutes = Math.round((parsed - hours) * 60);
  return { hours, minutes };
}

/**
 * Convert hours + minutes form values to job_schedule.dur decimal string (mirror EditJobs).
 */
export function formatDurationHoursForDb(hours, minutes) {
  const h = parseInt(hours, 10) || 0;
  const m = parseInt(minutes, 10) || 0;
  const totalMinutes = h * 60 + m;
  return (totalMinutes / 60).toFixed(2);
}

/**
 * Human-readable label for scheduler popup subtitle, e.g. "2h 30m".
 */
export function formatDurationLabel(durationHours) {
  if (durationHours == null || durationHours === '') return '';
  const parsed = parseFloat(durationHours);
  if (Number.isNaN(parsed) || parsed <= 0) return '';
  const { hours, minutes } = parseDurationHoursToForm(parsed);
  if (hours === '' && minutes === '') return '';
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(' ') : '';
}

/** Session key for persisting jobs list date filter within the browser tab. */
export const JOBS_DATE_FILTER_SESSION_KEY = 'jobs-list-date-filter';

export function formatJobsDateYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Past 7 calendar days (start = 6 days ago) through all future scheduled jobs (no end cap). */
export function getDefaultJobsDateRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return { start: formatJobsDateYmd(start), end: null };
}

export function isDefaultJobsDateRange(dateRange) {
  if (!dateRange?.start) return false;
  const def = getDefaultJobsDateRange();
  const endMatches = def.end == null ? !dateRange.end : dateRange.end === def.end;
  return dateRange.start === def.start && endMatches;
}

export function isUnboundedJobsDateRange(dateRange) {
  return !dateRange?.start && !dateRange?.end;
}

export function readPersistedJobsDateFilter() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(JOBS_DATE_FILTER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed === 'all') return { start: null, end: null };
    if (parsed?.start && parsed?.end) {
      return { start: parsed.start, end: parsed.end };
    }
    if (parsed?.start && (parsed.end == null || parsed.end === '')) {
      return { start: parsed.start, end: null };
    }
    if (parsed?.start === null && parsed?.end === null) {
      return { start: null, end: null };
    }
    return null;
  } catch {
    return null;
  }
}

export function persistJobsDateFilter(dateRange) {
  if (typeof window === 'undefined') return;
  try {
    if (isUnboundedJobsDateRange(dateRange)) {
      sessionStorage.setItem(JOBS_DATE_FILTER_SESSION_KEY, JSON.stringify('all'));
      return;
    }
    sessionStorage.setItem(JOBS_DATE_FILTER_SESSION_KEY, JSON.stringify(dateRange));
  } catch {
    // ignore quota / private mode
  }
}

/** True when query params match the default recent-jobs browse (7-day start, open future, no extra filters). */
export function isDefaultRecentJobsParams(params) {
  if (!params) return false;
  if (params.search || params.status || params.statusValues || params.priority) return false;
  const def = getDefaultJobsDateRange();
  return params.dateFrom === def.start && !params.dateTo;
}

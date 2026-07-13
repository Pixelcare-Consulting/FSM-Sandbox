import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { JOB_SATELLITE_QUERY_OPTIONS } from '../../lib/jobs/jobSatelliteQueryOptions';

const STALE_TIME_MS = 60_000;
const CACHE_TIME_MS = 10 * 60 * 1000;

/** Accept scheduler `{ start, end }` or API `{ rangeStart, rangeEnd }`. */
export function normalizeCalendarRange(range) {
  if (!range) return null;
  const rangeStart = range.rangeStart || range.start;
  const rangeEnd = range.rangeEnd || range.end;
  if (!rangeStart || !rangeEnd) return null;
  return { rangeStart, rangeEnd };
}

/**
 * @param {{ rangeStart?: string, rangeEnd?: string, start?: string, end?: string }} range
 */
export async function fetchJobsCalendarEvents(range) {
  const normalized = normalizeCalendarRange(range);
  if (!normalized) {
    throw new Error('Calendar range is required');
  }
  const params = new URLSearchParams({
    rangeStart: normalized.rangeStart,
    rangeEnd: normalized.rangeEnd,
  });
  const response = await fetch(`/api/jobs/calendar-events?${params}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    let message = 'Failed to fetch jobs';
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  return response.json();
}

/**
 * @param {{ rangeStart?: string, rangeEnd?: string, start?: string, end?: string }} range
 * @param {{ enabled?: boolean }} [options]
 */
export function useJobsCalendarQuery(range, { enabled = true } = {}) {
  const normalizedRange = normalizeCalendarRange(range);
  const hasRange = Boolean(normalizedRange);

  return useQuery(
    queryKeys.jobsCalendar(normalizedRange || range),
    () => fetchJobsCalendarEvents(range),
    {
      enabled: enabled && hasRange,
      staleTime: STALE_TIME_MS,
      cacheTime: CACHE_TIME_MS,
      keepPreviousData: true,
      ...JOB_SATELLITE_QUERY_OPTIONS,
    }
  );
}

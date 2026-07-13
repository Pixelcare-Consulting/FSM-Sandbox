import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchLiveTrackingSnapshot } from '../../lib/liveTracking/fetchLiveTrackingSnapshot';
import { JOB_SATELLITE_QUERY_OPTIONS } from '../../lib/jobs/jobSatelliteQueryOptions';

const STALE_TIME_MS = 30_000;
const CACHE_TIME_MS = 5 * 60 * 1000;

function toDateKey(mapDate) {
  if (mapDate instanceof Date && !Number.isNaN(mapDate.getTime())) {
    return mapDate.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {Date} mapDate
 * @param {{ enabled?: boolean }} [options]
 */
export function useLiveTrackingQuery(mapDate, { enabled = true } = {}) {
  const dateKey = toDateKey(mapDate);

  return useQuery(
    queryKeys.liveTracking(dateKey),
    () => fetchLiveTrackingSnapshot(mapDate),
    {
      enabled,
      staleTime: STALE_TIME_MS,
      cacheTime: CACHE_TIME_MS,
      keepPreviousData: true,
      ...JOB_SATELLITE_QUERY_OPTIONS,
    }
  );
}

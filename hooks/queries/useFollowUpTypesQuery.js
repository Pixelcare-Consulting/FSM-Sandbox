import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchFollowUpTypes, getDefaultFollowUpTypes } from '../../utils/followUpSettings';
import {
  JOB_SATELLITE_CACHE_MS,
  JOB_SATELLITE_QUERY_OPTIONS,
  JOB_SATELLITE_STALE_MS,
} from '../../lib/jobs/jobSatelliteQueryOptions';

export { fetchFollowUpTypes };

export function useFollowUpTypesQuery({ enabled = true } = {}) {
  return useQuery(queryKeys.followUpTypes(), () => fetchFollowUpTypes(), {
    enabled,
    staleTime: JOB_SATELLITE_STALE_MS,
    cacheTime: JOB_SATELLITE_CACHE_MS,
    initialData: getDefaultFollowUpTypes(),
    ...JOB_SATELLITE_QUERY_OPTIONS,
  });
}

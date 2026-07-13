import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchJobStatuses, getDefaultJobStatuses } from '../../utils/jobStatusSettings';
import { JOB_STATUS_CACHE_TTL_MS } from '../../utils/jobStatusDefaults';
import { JOB_SATELLITE_QUERY_OPTIONS } from '../../lib/jobs/jobSatelliteQueryOptions';

export { fetchJobStatuses };

export function useJobStatusesQuery({ enabled = true } = {}) {
  return useQuery(queryKeys.jobStatuses(), () => fetchJobStatuses(), {
    enabled,
    staleTime: JOB_STATUS_CACHE_TTL_MS,
    cacheTime: JOB_STATUS_CACHE_TTL_MS,
    initialData: getDefaultJobStatuses(),
    ...JOB_SATELLITE_QUERY_OPTIONS,
  });
}

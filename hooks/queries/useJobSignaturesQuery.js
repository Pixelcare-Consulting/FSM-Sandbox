import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchJobSignatures } from '../../lib/jobs/fetchJobSignatures';
import {
  JOB_SATELLITE_CACHE_MS,
  JOB_SATELLITE_QUERY_OPTIONS,
  JOB_SATELLITE_STALE_MS,
} from '../../lib/jobs/jobSatelliteQueryOptions';

export { fetchJobSignatures };

export function useJobSignaturesQuery(jobId, { enabled = true } = {}) {
  return useQuery(queryKeys.jobSignatures(jobId), () => fetchJobSignatures(jobId), {
    enabled: Boolean(enabled && jobId),
    staleTime: JOB_SATELLITE_STALE_MS,
    cacheTime: JOB_SATELLITE_CACHE_MS,
    ...JOB_SATELLITE_QUERY_OPTIONS,
  });
}

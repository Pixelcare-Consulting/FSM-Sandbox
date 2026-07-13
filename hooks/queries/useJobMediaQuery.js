import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchJobMediaImages } from '../../lib/jobs/fetchJobMediaImages';
import {
  JOB_SATELLITE_CACHE_MS,
  JOB_SATELLITE_QUERY_OPTIONS,
  JOB_SATELLITE_STALE_MS,
} from '../../lib/jobs/jobSatelliteQueryOptions';

export { fetchJobMediaImages };

export function useJobMediaQuery(jobId, { enabled = true } = {}) {
  return useQuery(queryKeys.jobMedia(jobId), () => fetchJobMediaImages(jobId), {
    enabled: Boolean(enabled && jobId),
    staleTime: JOB_SATELLITE_STALE_MS,
    cacheTime: JOB_SATELLITE_CACHE_MS,
    ...JOB_SATELLITE_QUERY_OPTIONS,
  });
}

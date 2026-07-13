import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchJobChatMessages } from '../../lib/jobs/fetchJobChatMessages';
import {
  JOB_SATELLITE_CACHE_MS,
  JOB_SATELLITE_QUERY_OPTIONS,
  JOB_SATELLITE_STALE_MS,
} from '../../lib/jobs/jobSatelliteQueryOptions';

export { fetchJobChatMessages };

export function useJobChatQuery(jobId, { enabled = true } = {}) {
  return useQuery(queryKeys.jobChat(jobId), () => fetchJobChatMessages(jobId), {
    enabled: Boolean(enabled && jobId),
    staleTime: JOB_SATELLITE_STALE_MS,
    cacheTime: JOB_SATELLITE_CACHE_MS,
    ...JOB_SATELLITE_QUERY_OPTIONS,
  });
}

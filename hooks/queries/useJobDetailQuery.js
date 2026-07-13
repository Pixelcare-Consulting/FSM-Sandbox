import { useQuery } from 'react-query';
import {
  fetchJobDetail,
  jobDetailQueryKey,
  JOB_DETAIL_STALE_MS,
  JOB_DETAIL_CACHE_MS,
  JOB_DETAIL_QUERY_OPTIONS,
} from '../../lib/jobs/jobDetailQueryKeys';

export { fetchJobDetail } from '../../lib/jobs/jobDetailQueryKeys';

export function useJobDetailQuery(jobId, options = {}) {
  const { enabled = true, ...queryOptions } = options;
  return useQuery(jobDetailQueryKey(jobId), () => fetchJobDetail(jobId), {
    enabled: Boolean(enabled && jobId),
    staleTime: JOB_DETAIL_STALE_MS,
    cacheTime: JOB_DETAIL_CACHE_MS,
    ...JOB_DETAIL_QUERY_OPTIONS,
    ...queryOptions,
  });
}

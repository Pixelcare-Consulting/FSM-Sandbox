import { queryKeys } from '../cache/queryKeys';
import { invalidateJobDetailServerCache } from './jobDetailQueryKeys';

/**
 * Invalidate React Query satellite caches and server detail cache after job mutations.
 * Returns a Promise so callers can await before navigating (e.g. Edit → View).
 * @param {import('react-query').QueryClient} queryClient
 * @param {string} jobId Route param and/or UUID used by queries
 * @param {{ customerCode?: string, aliasIds?: string[] }} [options]
 *        aliasIds — extra ids (UUID + job_number) so both cache keys are cleared
 */
export async function invalidateJobDetailSatellites(queryClient, jobId, options = {}) {
  if (!queryClient || !jobId) return;

  const ids = [
    ...new Set(
      [jobId, ...(Array.isArray(options.aliasIds) ? options.aliasIds : [])].filter(
        (id) => typeof id === 'string' && id.trim()
      )
    ),
  ];

  // Clear server cache first so any subsequent RQ refetch cannot hit a stale 45s payload.
  await Promise.all(ids.map((id) => invalidateJobDetailServerCache(id)));

  const tasks = [];
  for (const id of ids) {
    tasks.push(
      queryClient.invalidateQueries(queryKeys.jobChat(id)),
      queryClient.invalidateQueries(queryKeys.jobSignatures(id)),
      queryClient.invalidateQueries(queryKeys.jobMedia(id)),
      queryClient.invalidateQueries(queryKeys.jobDetail(id))
    );
  }

  if (options.customerCode) {
    tasks.push(
      queryClient.invalidateQueries(queryKeys.customerAddressDetails(options.customerCode))
    );
  }

  await Promise.all(tasks);
}

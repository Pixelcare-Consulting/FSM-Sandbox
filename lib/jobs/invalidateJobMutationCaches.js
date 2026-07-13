import { queryKeys } from '../cache/queryKeys';
import {
  clearAllJobsListSessionCache,
  invalidateJobsListServerCache,
} from '../../hooks/queries/useJobsListQuery';
import {
  dispatchSchedulerInvalidate,
  invalidateSchedulerServerCache,
} from '../scheduler/schedulerCache';
import { invalidateJobDetailSatellites } from './jobDetailSatelliteInvalidation';

/**
 * Bust server-side jobs calendar response cache.
 * @returns {Promise<void>}
 */
export function invalidateJobsCalendarServerCache() {
  if (typeof window === 'undefined') return Promise.resolve();
  return fetch('/api/jobs/invalidate-calendar-cache', {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * Bust server-side customer job-history response cache.
 * @returns {Promise<void>}
 */
export function invalidateCustomerJobHistoryServerCache() {
  if (typeof window === 'undefined') return Promise.resolve();
  return fetch('/api/customers/invalidate-job-history-cache', {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * After a job mutation, clear detail satellites plus list / calendar / history / scheduler caches
 * so Job List and related surfaces cannot resurrect stale descriptions.
 *
 * @param {import('react-query').QueryClient} queryClient
 * @param {string} jobId Route param and/or UUID used by queries
 * @param {{
 *   customerCode?: string,
 *   customerId?: string,
 *   aliasIds?: string[],
 *   skipScheduler?: boolean,
 * }} [options]
 */
export async function invalidateJobCachesAfterMutation(queryClient, jobId, options = {}) {
  if (!queryClient || !jobId) return;

  await invalidateJobDetailSatellites(queryClient, jobId, {
    customerCode: options.customerCode,
    aliasIds: options.aliasIds,
  });

  clearAllJobsListSessionCache();

  const customerKeys = [
    ...new Set(
      [options.customerId, options.customerCode].filter(
        (id) => typeof id === 'string' && id.trim()
      )
    ),
  ];

  // Clear server caches first so any RQ refetch cannot hit a stale TTL payload.
  const serverTasks = [
    invalidateJobsListServerCache(),
    invalidateJobsCalendarServerCache(),
    invalidateCustomerJobHistoryServerCache(),
  ];
  if (!options.skipScheduler) {
    dispatchSchedulerInvalidate();
    serverTasks.push(invalidateSchedulerServerCache());
  }
  await Promise.all(serverTasks);

  await Promise.all([
    queryClient.invalidateQueries(queryKeys.jobsList()),
    // Prefix only — jobsCalendar(range) always appends a range segment.
    queryClient.invalidateQueries(['jobs', 'calendar']),
    ...customerKeys.map((key) =>
      queryClient.invalidateQueries(queryKeys.customerJobHistory(key))
    ),
  ]);
}

/**
 * Optimistically merge description fields into every cached jobs-list page.
 * Matches by id and/or job_number so soft-nav back to the list shows the new text immediately.
 *
 * @param {import('react-query').QueryClient} queryClient
 * @param {{ matchIds?: Array<string|null|undefined>, description: string }} patch
 */
export function patchJobsListDescriptionCaches(queryClient, patch) {
  if (!queryClient || !patch) return;

  const matchIds = new Set(
    (Array.isArray(patch.matchIds) ? patch.matchIds : [])
      .filter((id) => id != null && String(id).trim())
      .map((id) => String(id))
  );
  if (matchIds.size === 0) return;

  const description = patch.description ?? '';

  queryClient.setQueriesData(queryKeys.jobsList(), (oldData) => {
    if (!oldData?.jobs || !Array.isArray(oldData.jobs)) return oldData;

    let changed = false;
    const jobs = oldData.jobs.map((row) => {
      const rowId = row?.id != null ? String(row.id) : '';
      const rowJobNo =
        row?.job_number != null
          ? String(row.job_number)
          : row?.jobNo != null
            ? String(row.jobNo)
            : '';
      if (!matchIds.has(rowId) && !matchIds.has(rowJobNo)) return row;
      changed = true;
      return {
        ...row,
        description,
        jobDescription: description,
      };
    });

    return changed ? { ...oldData, jobs } : oldData;
  });
}

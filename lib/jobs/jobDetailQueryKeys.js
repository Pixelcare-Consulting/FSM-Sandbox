export const JOB_DETAIL_STALE_MS = 3 * 60 * 1000;
export const JOB_DETAIL_CACHE_MS = 10 * 60 * 1000;

export const JOB_DETAIL_QUERY_OPTIONS = {
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
};

/** @param {string} jobId Route param — UUID or job_number */
export function jobDetailQueryKey(jobId) {
  return ['jobs', 'detail', jobId];
}

/** @param {string} jobId */
export async function fetchJobDetail(jobId) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/detail`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load job (${response.status})`);
  }
  return response.json();
}

/**
 * Invalidate the server-side job-detail response cache.
 * Returns a Promise so callers can await before refetching.
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export function invalidateJobDetailServerCache(jobId) {
  if (typeof window === 'undefined' || !jobId) return Promise.resolve();
  return fetch(`/api/jobs/${encodeURIComponent(jobId)}/invalidate-detail-cache`, {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then(() => undefined)
    .catch(() => undefined);
}

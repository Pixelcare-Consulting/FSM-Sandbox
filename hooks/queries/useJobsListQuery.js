import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { patchListPage, removeListRow } from '../../lib/cache/patchListCache';
import { isDefaultRecentJobsParams } from '../../lib/jobs/defaultJobsDateRange';

const STALE_TIME_DEFAULT_MS = 5 * 60 * 1000;
const STALE_TIME_FILTERED_MS = 60_000;
const CACHE_TIME_MS = 15 * 60 * 1000;
const SESSION_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const JOBS_LIST_CACHE_STORAGE_KEY = 'jobs-list-cache';

function buildJobsListSearchParams(params) {
  const searchParams = new URLSearchParams();
  const entries = {
    page: params.page,
    limit: params.limit,
    search: params.search,
    status: params.status,
    statusValues: params.statusValues,
    priority: params.priority,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    sort: params.sort,
    sortDir: params.sortDir,
  };
  Object.entries(entries).forEach(([key, value]) => {
    if (value != null && value !== '') {
      searchParams.set(key, String(value));
    }
  });
  return searchParams;
}

export async function fetchJobsList(params) {
  const response = await fetch(`/api/jobs/list-summary?${buildJobsListSearchParams(params).toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load jobs (${response.status})`);
  }
  return response.json();
}

function serializeQueryKey(queryKey) {
  return JSON.stringify(queryKey);
}

function readJobsListSessionCache(queryKey) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(JOBS_LIST_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw);
    const entry = store[serializeQueryKey(queryKey)];
    if (!entry?.data || !entry.fetchedAt) return null;
    if (Date.now() - entry.fetchedAt > SESSION_CACHE_MAX_AGE_MS) return null;
    return { data: entry.data, fetchedAt: entry.fetchedAt };
  } catch {
    return null;
  }
}

export function writeJobsListSessionCache(queryKey, data) {
  if (typeof window === 'undefined' || !data) return;
  try {
    const raw = sessionStorage.getItem(JOBS_LIST_CACHE_STORAGE_KEY);
    const store = raw ? JSON.parse(raw) : {};
    store[serializeQueryKey(queryKey)] = {
      data,
      fetchedAt: Date.now(),
    };
    sessionStorage.setItem(JOBS_LIST_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota / private mode
  }
}

export function clearJobsListSessionCache(queryKey) {
  if (typeof window === 'undefined' || !queryKey) return;
  try {
    const raw = sessionStorage.getItem(JOBS_LIST_CACHE_STORAGE_KEY);
    if (!raw) return;
    const store = JSON.parse(raw);
    delete store[serializeQueryKey(queryKey)];
    sessionStorage.setItem(JOBS_LIST_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore quota / private mode
  }
}

/** Drop every jobs-list sessionStorage entry (all param variants). */
export function clearAllJobsListSessionCache() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(JOBS_LIST_CACHE_STORAGE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Bust server-side jobs-summary / count caches.
 * Returns a Promise so callers can await before refetching.
 * @returns {Promise<void>}
 */
export function invalidateJobsListServerCache() {
  if (typeof window === 'undefined') return Promise.resolve();
  return fetch('/api/jobs/invalidate-list-cache', {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function useJobsListQuery(params, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.jobsList(params);

  const sessionEntry = useMemo(
    () => readJobsListSessionCache(queryKey),
    [queryKey]
  );

  const staleTime = isDefaultRecentJobsParams(params)
    ? STALE_TIME_DEFAULT_MS
    : STALE_TIME_FILTERED_MS;

  const query = useQuery(queryKey, () => fetchJobsList(params), {
    enabled,
    staleTime,
    cacheTime: CACHE_TIME_MS,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    initialData: sessionEntry?.data,
    initialDataUpdatedAt: sessionEntry?.fetchedAt,
    onSuccess: (data) => {
      writeJobsListSessionCache(queryKey, data);
    },
  });

  const patchRow = useCallback(
    (row, eventType = 'UPDATE') => {
      patchListPage(queryClient, queryKeys.jobsList(), row, {
        itemsKey: 'jobs',
        idField: 'id',
        eventType,
      });
    },
    [queryClient]
  );

  const removeRow = useCallback(
    (rowId) => {
      removeListRow(queryClient, queryKeys.jobsList(), rowId, {
        itemsKey: 'jobs',
        idField: 'id',
      });
    },
    [queryClient]
  );

  return {
    ...query,
    patchRow,
    removeRow,
  };
}

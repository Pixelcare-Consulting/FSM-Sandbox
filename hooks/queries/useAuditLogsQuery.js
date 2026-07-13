import { useQuery } from 'react-query';

const STALE_TIME_MS = 30_000;
const CACHE_TIME_MS = 5 * 60 * 1000;

const AUDIT_LOGS_QUERY_OPTIONS = {
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
};

/**
 * @param {{
 *   page: number,
 *   limit: number,
 *   category?: string,
 *   status?: string,
 *   search?: string,
 *   dateFrom?: string | null,
 *   dateTo?: string | null,
 * }} params
 */
export function auditLogsQueryKey(params) {
  return [
    'audit-logs',
    'list',
    params.page,
    params.limit,
    params.category || 'all',
    params.status || 'all',
    params.search || '',
    params.dateFrom || '',
    params.dateTo || '',
  ];
}

/**
 * @param {{
 *   page: number,
 *   limit: number,
 *   category?: string,
 *   status?: string,
 *   search?: string,
 *   dateFrom?: string | null,
 *   dateTo?: string | null,
 * }} params
 */
export async function fetchAuditLogsList(params) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.category && params.category !== 'all') {
    searchParams.set('category', params.category);
  }
  if (params.status && params.status !== 'all') {
    searchParams.set('status', params.status);
  }
  if (params.search?.trim()) {
    searchParams.set('search', params.search.trim());
  }
  if (params.dateFrom) {
    searchParams.set('dateFrom', params.dateFrom);
  }
  if (params.dateTo) {
    searchParams.set('dateTo', params.dateTo);
  }

  const response = await fetch(`/api/audit-logs?${searchParams.toString()}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || `Failed to load audit logs (${response.status})`);
  }
  return json;
}

/**
 * @param {Parameters<typeof fetchAuditLogsList>[0]} params
 * @param {{ enabled?: boolean }} [options]
 */
export function useAuditLogsQuery(params, { enabled = true } = {}) {
  return useQuery(auditLogsQueryKey(params), () => fetchAuditLogsList(params), {
    enabled,
    staleTime: STALE_TIME_MS,
    cacheTime: CACHE_TIME_MS,
    keepPreviousData: true,
    ...AUDIT_LOGS_QUERY_OPTIONS,
  });
}

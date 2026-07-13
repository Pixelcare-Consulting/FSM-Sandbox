import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';

const STALE_TIME_MS = 30 * 1000;
const CACHE_TIME_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 20;

export async function fetchNotificationsSummary(limit = DEFAULT_LIMIT) {
  const response = await fetch(`/api/notifications/summary?limit=${limit}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load notifications (${response.status})`);
  }
  return response.json();
}

export function useNotificationsQuery({ enabled = true, limit = DEFAULT_LIMIT } = {}) {
  return useQuery(queryKeys.notificationsSummary(limit), () => fetchNotificationsSummary(limit), {
    enabled,
    staleTime: STALE_TIME_MS,
    cacheTime: CACHE_TIME_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

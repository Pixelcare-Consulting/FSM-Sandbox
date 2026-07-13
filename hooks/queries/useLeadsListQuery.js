import { useCallback } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { patchListPage, removeListRow } from '../../lib/cache/patchListCache';

const STALE_TIME_MS = 60_000;

export async function fetchLeadsList(params) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.search) {
    searchParams.set('search', params.search);
  }

  const response = await fetch(`/api/leads/masterlist-summary?${searchParams.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load leads (${response.status})`);
  }
  return response.json();
}

export function useLeadsListQuery(params, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.leadsList(params);

  const query = useQuery(queryKey, () => fetchLeadsList(params), {
    enabled,
    staleTime: STALE_TIME_MS,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const patchRow = useCallback(
    (row, eventType = 'UPDATE') => {
      patchListPage(queryClient, queryKeys.leadsList(), row, {
        itemsKey: 'leads',
        idField: 'CardCode',
        eventType,
      });
    },
    [queryClient]
  );

  const removeRow = useCallback(
    (rowId) => {
      removeListRow(queryClient, queryKeys.leadsList(), rowId, {
        itemsKey: 'leads',
        idField: 'CardCode',
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

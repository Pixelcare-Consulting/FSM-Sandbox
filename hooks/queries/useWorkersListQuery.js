import { useCallback } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { patchListPage, removeListRow } from '../../lib/cache/patchListCache';

const STALE_TIME_MS = 45_000;

async function fetchWorkersList(params) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.search?.trim()) {
    searchParams.set('search', params.search.trim());
  }
  if (params.includeStats) {
    searchParams.set('includeStats', '1');
  }

  const response = await fetch(`/api/workers/summary?${searchParams.toString()}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load workers (${response.status})`);
  }
  return response.json();
}

export function useWorkersListQuery(params, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.workersList(params);

  const query = useQuery(queryKey, () => fetchWorkersList(params), {
    enabled,
    staleTime: STALE_TIME_MS,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const patchRow = useCallback(
    (row, eventType = 'UPDATE') => {
      patchListPage(queryClient, queryKeys.workersList(), row, {
        itemsKey: 'workers',
        idField: 'id',
        eventType,
      });
    },
    [queryClient]
  );

  const removeRow = useCallback(
    (rowId) => {
      removeListRow(queryClient, queryKeys.workersList(), rowId, {
        itemsKey: 'workers',
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

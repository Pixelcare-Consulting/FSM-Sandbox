import { useCallback } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { patchListPage, removeListRow } from '../../lib/cache/patchListCache';

const STALE_TIME_MS = 30_000;

function buildFollowUpsSearchParams(params) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  const optional = {
    followUpId: params.followUpId,
    status: params.status,
    type: params.type,
    assignedWorker: params.assignedWorker,
    customerSearch: params.customerSearch,
    jobNumber: params.jobNumber,
    priority: params.priority,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  };
  Object.entries(optional).forEach(([key, value]) => {
    if (value != null && value !== '' && value !== 'all') {
      searchParams.set(key, String(value));
    }
  });
  return searchParams;
}

export async function fetchFollowUpsList(params) {
  const response = await fetch(
    `/api/follow-ups/list-summary?${buildFollowUpsSearchParams(params).toString()}`,
    { cache: 'no-store', credentials: 'same-origin' }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load follow-ups (${response.status})`);
  }
  return response.json();
}

export function useFollowUpsListQuery(params, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.followUpsList(params);

  const query = useQuery(queryKey, () => fetchFollowUpsList(params), {
    enabled,
    staleTime: STALE_TIME_MS,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const patchRow = useCallback(
    (row, eventType = 'UPDATE') => {
      patchListPage(queryClient, queryKeys.followUpsList(), row, {
        itemsKey: 'followUps',
        idField: 'id',
        eventType,
      });
    },
    [queryClient]
  );

  const removeRow = useCallback(
    (rowId) => {
      removeListRow(queryClient, queryKeys.followUpsList(), rowId, {
        itemsKey: 'followUps',
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

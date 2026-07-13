import { useCallback } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { patchListPage, removeListRow } from '../../lib/cache/patchListCache';

const STALE_TIME_MS = 60_000;

async function fetchCustomerJobHistory(customerId, params) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });
  if (params.search) {
    searchParams.set('search', params.search);
  }

  const response = await fetch(
    `/api/customers/job-history/${encodeURIComponent(customerId)}?${searchParams.toString()}`,
    { cache: 'no-store', credentials: 'same-origin' }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load job history (${response.status})`);
  }
  return response.json();
}

export function useCustomerJobHistoryQuery(customerId, params, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.customerJobHistory(customerId, params);

  const query = useQuery(
    queryKey,
    () => fetchCustomerJobHistory(customerId, params),
    {
      enabled: Boolean(enabled && customerId),
      staleTime: STALE_TIME_MS,
      keepPreviousData: true,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    }
  );

  const patchRow = useCallback(
    (row, eventType = 'UPDATE') => {
      if (!customerId) return;
      patchListPage(queryClient, queryKeys.customerJobHistory(customerId), row, {
        itemsKey: 'jobs',
        idField: 'id',
        eventType,
      });
    },
    [queryClient, customerId]
  );

  const removeRow = useCallback(
    (rowId) => {
      if (!customerId) return;
      removeListRow(queryClient, queryKeys.customerJobHistory(customerId), rowId, {
        itemsKey: 'jobs',
        idField: 'id',
      });
    },
    [queryClient, customerId]
  );

  return {
    ...query,
    patchRow,
    removeRow,
  };
}

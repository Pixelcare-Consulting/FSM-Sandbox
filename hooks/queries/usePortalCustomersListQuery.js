import { useCallback } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchPortalCustomersList } from '../../lib/leads/buildPortalCustomersList';

const STALE_TIME_MS = 60_000;

export function usePortalCustomersListQuery({ enabled = true } = {}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.portalCustomersList();

  const query = useQuery(queryKey, fetchPortalCustomersList, {
    enabled,
    staleTime: STALE_TIME_MS,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries(queryKeys.portalCustomersList());
  }, [queryClient]);

  const removeRow = useCallback(
    (rowId) => {
      queryClient.setQueryData(queryKey, (old) => {
        if (!old?.rows) return old;
        return { ...old, rows: old.rows.filter((row) => row.id !== rowId) };
      });
    },
    [queryClient, queryKey]
  );

  return {
    ...query,
    rows: query.data?.rows ?? [],
    invalidate,
    removeRow,
  };
}

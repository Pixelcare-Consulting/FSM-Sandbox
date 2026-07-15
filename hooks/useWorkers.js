// hooks/useWorkers.js
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from 'react-query';
import { useWorkersListQuery } from './queries/useWorkersListQuery';

const DEFAULT_PAGE_SIZE = 25;

export const useWorkers = ({ pageSize = DEFAULT_PAGE_SIZE } = {}) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [includeStats, setIncludeStats] = useState(true);
  const isFirstLoadRef = useRef(true);

  const workersQueryParams = useMemo(
    () => ({
      page,
      limit: pageSize,
      search,
      includeStats,
    }),
    [page, pageSize, search, includeStats]
  );

  const {
    data: workersData,
    isLoading: loading,
    error: workersQueryError,
    refetch,
  } = useWorkersListQuery(workersQueryParams);

  const workers = workersData?.workers || [];
  const totalCount = workersData?.totalCount ?? 0;
  const stats = workersData?.stats || {
    totalUsers: 0,
    active: 0,
    inactive: 0,
    fieldWorkers: 0,
  };
  const error = workersQueryError ?? null;

  useEffect(() => {
    if (isFirstLoadRef.current && workersData) {
      isFirstLoadRef.current = false;
      setIncludeStats(false);
    }
  }, [workersData]);

  const fetchWorkers = useCallback(async () => {
    setIncludeStats(true);
    const result = await refetch();
    setIncludeStats(false);
    return result.data;
  }, [refetch]);

  const clearCache = useCallback(() => {
    queryClient.removeQueries(['workers']);
  }, [queryClient]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const goToPage = useCallback((nextPage) => {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    setPage(safePage);
  }, [totalPages]);

  const updateSearch = useCallback((value) => {
    setSearch(value);
    setPage(1);
  }, []);

  return {
    workers,
    loading,
    error,
    fetchWorkers,
    clearCache,
    page,
    pageSize,
    totalCount,
    totalPages,
    goToPage,
    search,
    updateSearch,
    stats,
  };
};

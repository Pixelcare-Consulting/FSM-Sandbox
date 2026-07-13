// hooks/useWorkers.js
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from 'react-query';
import { getSupabaseClient } from '../lib/supabase/client';
import { useWorkersListQuery } from './queries/useWorkersListQuery';

const REALTIME_DEBOUNCE_MS = 2500;
const REALTIME_FULL_REFETCH_MIN_MS = 30_000;
const DEFAULT_PAGE_SIZE = 25;

function patchWorkerFromUserRow(worker, userRow) {
  if (!userRow || !worker) return worker;
  const technicians = Array.isArray(userRow.technicians)
    ? userRow.technicians
    : userRow.technicians
      ? [userRow.technicians]
      : worker.technicians;
  const technician = technicians?.[0] || worker.technicians?.[0] || null;
  return {
    ...worker,
    ...userRow,
    role: userRow.role ?? worker.role,
    status: userRow.status ?? worker.status,
    username: userRow.username ?? worker.username,
    email: technician?.email || userRow.username || worker.email,
    activeUser: (userRow.status ?? worker.status) === 'ACTIVE',
    isActive: (userRow.status ?? worker.status) === 'ACTIVE',
    isAdmin: (userRow.role ?? worker.role) === 'ADMIN',
    isFieldWorker: (userRow.role ?? worker.role) === 'TECHNICIAN',
    technicians,
    profilePicture: technician?.avatar_url || worker.profilePicture,
    isOnline:
      technicians?.some((t) => Boolean(t?.is_online)) ||
      Boolean(userRow.is_logged_in) ||
      worker.isOnline,
  };
}

export const useWorkers = ({ pageSize = DEFAULT_PAGE_SIZE } = {}) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [includeStats, setIncludeStats] = useState(true);
  const debounceRef = useRef(null);
  const pendingRealtimeEventsRef = useRef([]);
  const lastFullRefetchAtRef = useRef(0);
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
    patchRow,
    removeRow,
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

  const workersRef = useRef(workers);
  const patchRowRef = useRef(patchRow);
  const removeRowRef = useRef(removeRow);
  const refetchRef = useRef(refetch);
  workersRef.current = workers;
  patchRowRef.current = patchRow;
  removeRowRef.current = removeRow;
  refetchRef.current = refetch;

  useEffect(() => {
    if (isFirstLoadRef.current && workersData) {
      isFirstLoadRef.current = false;
      setIncludeStats(false);
    }
  }, [workersData]);

  useEffect(() => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client not available');
      }

      const throttledRefetch = () => {
        const now = Date.now();
        if (now - lastFullRefetchAtRef.current < REALTIME_FULL_REFETCH_MIN_MS) return;
        lastFullRefetchAtRef.current = now;
        refetchRef.current().catch((err) => {
          console.error('Error updating workers from realtime:', err);
        });
      };

      const processBatchedEvents = (events) => {
        if (!events.length) return;

        let needsFullRefetch = false;

        for (const payload of events) {
          const eventType = payload?.eventType;
          const newRow = payload?.new;
          const oldRow = payload?.old;

          if (eventType === 'DELETE' && oldRow?.id) {
            removeRowRef.current(oldRow.id);
            continue;
          }

          if (eventType === 'INSERT') {
            needsFullRefetch = true;
            continue;
          }

          if (eventType === 'UPDATE' && newRow?.id) {
            const existing = workersRef.current.find((w) => w.id === newRow.id);
            if (!existing) {
              needsFullRefetch = true;
              continue;
            }
            patchRowRef.current(patchWorkerFromUserRow(existing, newRow), 'UPDATE');
            continue;
          }

          needsFullRefetch = true;
        }

        if (needsFullRefetch) {
          throttledRefetch();
        }
      };

      const channel = supabase
        .channel('users-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'users',
            filter: 'deleted_at=is.null',
          },
          (payload) => {
            pendingRealtimeEventsRef.current.push(payload);
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
            }
            debounceRef.current = setTimeout(() => {
              const batch = pendingRealtimeEventsRef.current;
              pendingRealtimeEventsRef.current = [];
              processBatchedEvents(batch);
            }, REALTIME_DEBOUNCE_MS);
          }
        )
        .subscribe();

      return () => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        pendingRealtimeEventsRef.current = [];
        supabase.removeChannel(channel);
      };
    } catch (err) {
      console.error('Error in useWorkers setup:', err);
    }
  }, []);

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

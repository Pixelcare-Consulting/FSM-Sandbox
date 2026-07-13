import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, subDays } from "date-fns";
import {
  computeSchedulerFetchRange,
  schedulerFetchRangeKey,
} from "./schedulerFetchRange";
import {
  getSchedulerCacheFetchedAt,
  invalidateSchedulerCache,
  readSchedulerCache,
  REVALIDATE_MIN_INTERVAL_MS,
  STATIC_TECH_TTL_MS,
  techniciansCacheKey,
  WINDOW_DATA_TTL_MS,
  windowCacheKey,
  writeSchedulerCache,
} from "./schedulerCache";
import {
  fetchSchedulerTechnicians,
  fetchSchedulerWindowData,
  hydrateSchedulerEvents,
  normalizeSchedulerTechnicians,
} from "./technicianSchedulerService";

const NAV_DEBOUNCE_MS = 200;
const PREFETCH_DELAY_MS = 400;

function isSchedulerRange(value) {
  return Boolean(value?.start && value?.end);
}

function hasCachedTechnicians(technicians) {
  return Array.isArray(technicians) && technicians.length > 0;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

/**
 * Stale-while-revalidate data hook for the worker scheduler.
 * Technicians (15 min TTL) are fetched separately from windowed events (90s TTL).
 */
export function useSchedulerData({ viewMode, selectedDate, includeUndated = false }) {
  const [resources, setResources] = useState([]);
  const [events, setEvents] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [undatedByTech, setUndatedByTech] = useState({});
  const [loading, setLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(null);

  const hasLoadedOnceRef = useRef(false);
  const fetchRangeKeyRef = useRef("");
  const dataVersionRef = useRef(null);
  const requestSeqRef = useRef(0);
  const windowAbortRef = useRef(null);
  const inFlightRefreshRef = useRef(null);
  const navDebounceRef = useRef(null);
  const prefetchTimerRef = useRef(null);

  const isCacheRecentlyFetched = useCallback((key, ttlMs) => {
    const fetchedAt = getSchedulerCacheFetchedAt(key, ttlMs);
    return fetchedAt != null && Date.now() - fetchedAt < REVALIDATE_MIN_INTERVAL_MS;
  }, []);

  const applyUndated = useCallback((undatedAssignments) => {
    const undatedMap = {};
    (undatedAssignments || []).forEach((a) => {
      if (!undatedMap[a.technicianId]) undatedMap[a.technicianId] = [];
      undatedMap[a.technicianId].push(a);
    });
    setUndatedByTech(undatedMap);
  }, []);

  const mergeWindowPayload = useCallback((windowPayload, technicians) => {
    const normalizedTechnicians = normalizeSchedulerTechnicians(technicians);
    setResources(normalizedTechnicians);
    const hydratedEvents = hydrateSchedulerEvents(
      windowPayload.events || [],
      normalizedTechnicians
    );
    setEvents(hydratedEvents);
    setCalendarEvents(windowPayload.calendarEvents || []);
    applyUndated(windowPayload.undatedAssignments);
    const version = windowPayload.dataVersion || null;
    dataVersionRef.current = version;
    setDataVersion(version);
  }, [applyUndated]);

  const paintFromCache = useCallback(
    (range) => {
      const windowKey = windowCacheKey(range, includeUndated);
      const cachedWindow = readSchedulerCache(windowKey, WINDOW_DATA_TTL_MS);
      const cachedTechs = readSchedulerCache(techniciansCacheKey(), STATIC_TECH_TTL_MS)
        ?.technicians;
      const canPaint = Boolean(cachedWindow) && hasCachedTechnicians(cachedTechs);

      if (hasCachedTechnicians(cachedTechs)) {
        setResources(normalizeSchedulerTechnicians(cachedTechs));
      }
      if (canPaint) {
        mergeWindowPayload(cachedWindow, cachedTechs);
        if (!hasLoadedOnceRef.current) {
          hasLoadedOnceRef.current = true;
          setLoading(false);
        }
      }
      return canPaint;
    },
    [includeUndated, mergeWindowPayload]
  );

  const loadTechnicians = useCallback(async ({ background = false } = {}) => {
    const key = techniciansCacheKey();
    const cached = readSchedulerCache(key, STATIC_TECH_TTL_MS);
    const cachedTechnicians = cached?.technicians;

    if (hasCachedTechnicians(cachedTechnicians)) {
      setResources(normalizeSchedulerTechnicians(cachedTechnicians));
      if (background) {
        if (isCacheRecentlyFetched(key, STATIC_TECH_TTL_MS)) {
          return cachedTechnicians;
        }
        void (async () => {
          try {
            const payload = await fetchSchedulerTechnicians();
            writeSchedulerCache(key, payload);
            setResources(normalizeSchedulerTechnicians(payload.technicians || []));
          } catch (error) {
            console.error("Scheduler.technicians.revalidate", error);
          }
        })();
        return cachedTechnicians;
      }
      return cachedTechnicians;
    }

    const payload = await fetchSchedulerTechnicians();
    writeSchedulerCache(key, payload);
    const technicians = payload.technicians || [];
    setResources(normalizeSchedulerTechnicians(technicians));
    return technicians;
  }, [isCacheRecentlyFetched]);

  const resolveTechniciansForWindow = useCallback(
    (techniciansOverride) =>
      techniciansOverride ||
      readSchedulerCache(techniciansCacheKey(), STATIC_TECH_TTL_MS)?.technicians ||
      [],
    []
  );

  const revalidateWindowInBackground = useCallback(
    async (range, key, techniciansOverride, { signal, isStale } = {}) => {
      try {
        const payload = await fetchSchedulerWindowData(range, {
          includeUndated,
          dataVersion: dataVersionRef.current,
          signal,
        });

        if (isStale?.()) return;

        if (payload.unchanged) {
          if (payload.dataVersion) {
            dataVersionRef.current = payload.dataVersion;
            setDataVersion(payload.dataVersion);
          }
          return;
        }

        writeSchedulerCache(key, payload);
        if (isStale?.()) return;
        mergeWindowPayload(payload, resolveTechniciansForWindow(techniciansOverride));
      } catch (error) {
        if (isAbortError(error)) return;
        console.error("Scheduler.window.revalidate", error);
      }
    },
    [includeUndated, mergeWindowPayload, resolveTechniciansForWindow]
  );

  const loadWindow = useCallback(
    async (
      range,
      { background = false, techniciansOverride, signal, isStale, prefetchOnly = false } = {}
    ) => {
      const key = windowCacheKey(range, includeUndated);
      const cached = readSchedulerCache(key, WINDOW_DATA_TTL_MS);
      const techs = resolveTechniciansForWindow(techniciansOverride);

      if (cached && background) {
        if (!prefetchOnly && !isStale?.()) {
          mergeWindowPayload(cached, techs);
        }
        if (!isCacheRecentlyFetched(key, WINDOW_DATA_TTL_MS)) {
          void revalidateWindowInBackground(range, key, techniciansOverride, { signal, isStale });
        }
        return cached;
      }

      if (cached && !background) {
        if (!prefetchOnly && !isStale?.()) {
          mergeWindowPayload(cached, techs);
        }
        return cached;
      }

      const payload = await fetchSchedulerWindowData(range, {
        includeUndated,
        dataVersion: null,
        signal,
      });

      if (isStale?.()) return payload;

      if (payload.unchanged) {
        if (payload.dataVersion) {
          dataVersionRef.current = payload.dataVersion;
          if (!prefetchOnly && !isStale?.()) {
            setDataVersion(payload.dataVersion);
          }
        }
        return { unchanged: true, dataVersion: payload.dataVersion };
      }

      writeSchedulerCache(key, payload);
      if (prefetchOnly || isStale?.()) return payload;

      const freshTechs =
        techniciansOverride ||
        readSchedulerCache(techniciansCacheKey(), STATIC_TECH_TTL_MS)?.technicians ||
        (await loadTechnicians({ background: true }));
      if (isStale?.()) return payload;
      mergeWindowPayload(payload, freshTechs);
      return payload;
    },
    [
      includeUndated,
      loadTechnicians,
      mergeWindowPayload,
      revalidateWindowInBackground,
      resolveTechniciansForWindow,
      isCacheRecentlyFetched,
    ]
  );

  const prefetchWindow = useCallback(
    async (range) => {
      if (inFlightRefreshRef.current?.promise) return;

      const key = windowCacheKey(range, includeUndated);
      if (readSchedulerCache(key, WINDOW_DATA_TTL_MS)) return;

      try {
        const payload = await fetchSchedulerWindowData(range, {
          includeUndated,
          dataVersion: null,
        });
        if (!payload.unchanged) {
          writeSchedulerCache(key, payload);
        }
      } catch (error) {
        if (!isAbortError(error)) {
          console.debug("Scheduler.window.prefetch", error);
        }
      }
    },
    [includeUndated]
  );

  const scheduleAdjacentPrefetch = useCallback(
    (mode, date) => {
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = setTimeout(() => {
        prefetchTimerRef.current = null;
        if (mode !== "day") return;
        const anchor = date instanceof Date ? date : new Date(date);
        void prefetchWindow(computeSchedulerFetchRange(mode, subDays(anchor, 1)));
        void prefetchWindow(computeSchedulerFetchRange(mode, addDays(anchor, 1)));
      }, PREFETCH_DELAY_MS);
    },
    [prefetchWindow]
  );

  const refreshData = useCallback(
    async (rangeOverride, { force = false, rangeKey: rangeKeyOverride } = {}) => {
      const range = isSchedulerRange(rangeOverride)
        ? rangeOverride
        : computeSchedulerFetchRange(viewMode, selectedDate);
      const rangeKey =
        rangeKeyOverride ?? `${schedulerFetchRangeKey(range)}|undated:${includeUndated}`;

      const inFlight = inFlightRefreshRef.current;
      if (!force && inFlight?.rangeKey === rangeKey && inFlight.promise) {
        return inFlight.promise;
      }

      if (inFlight?.rangeKey !== rangeKey) {
        windowAbortRef.current?.abort();
      }

      const seq = ++requestSeqRef.current;
      const controller = new AbortController();
      windowAbortRef.current = controller;

      const isStale = () =>
        requestSeqRef.current !== seq || fetchRangeKeyRef.current !== rangeKey;

      const runRefresh = async () => {
        const wasAlreadyLoaded = hasLoadedOnceRef.current;

        if (!wasAlreadyLoaded) {
          setLoading(true);
        }

        try {
          const techKey = techniciansCacheKey();
          const windowKey = windowCacheKey(range, includeUndated);
          if (force) {
            invalidateSchedulerCache(techKey);
            invalidateSchedulerCache(windowKey);
          }

          const cachedTechs = !force
            ? readSchedulerCache(techKey, STATIC_TECH_TTL_MS)?.technicians
            : null;
          const cachedWindow = !force ? readSchedulerCache(windowKey, WINDOW_DATA_TTL_MS) : null;
          const canPaintFromCache =
            Boolean(cachedWindow) && hasCachedTechnicians(cachedTechs);

          if (hasCachedTechnicians(cachedTechs) && !isStale()) {
            setResources(normalizeSchedulerTechnicians(cachedTechs));
          }
          if (canPaintFromCache && !isStale()) {
            mergeWindowPayload(cachedWindow, cachedTechs);
            if (!hasLoadedOnceRef.current) {
              hasLoadedOnceRef.current = true;
              setLoading(false);
            }
          }

          const technicians = await loadTechnicians({
            background: Boolean(hasCachedTechnicians(cachedTechs)),
          });
          if (isStale()) return;

          await loadWindow(range, {
            background: canPaintFromCache,
            techniciansOverride: technicians,
            signal: controller.signal,
            isStale,
          });

          if (!isStale() && wasAlreadyLoaded) {
            scheduleAdjacentPrefetch(viewMode, selectedDate);
          }
        } catch (error) {
          if (isAbortError(error)) return;
          console.error("Scheduler.fetch", error);
          if (!isStale()) fetchRangeKeyRef.current = "";
        } finally {
          if (!isStale()) {
            setLoading(false);
            hasLoadedOnceRef.current = true;
          }
        }
      };

      const promise = runRefresh();
      inFlightRefreshRef.current = { rangeKey, promise };
      try {
        return await promise;
      } finally {
        if (inFlightRefreshRef.current?.promise === promise) {
          inFlightRefreshRef.current = null;
        }
      }
    },
    [
      viewMode,
      selectedDate,
      includeUndated,
      loadTechnicians,
      loadWindow,
      mergeWindowPayload,
      scheduleAdjacentPrefetch,
    ]
  );

  const invalidateCurrentRange = useCallback(() => {
    const range = computeSchedulerFetchRange(viewMode, selectedDate);
    invalidateSchedulerCache(windowCacheKey(range, includeUndated));
  }, [viewMode, selectedDate, includeUndated]);

  const patchEvent = useCallback(
    (updatedEvent) => {
      if (!updatedEvent) return;
      setEvents((prev) => {
        const id = updatedEvent.technicianJobId ?? updatedEvent.id;
        const idx = prev.findIndex(
          (e) => (e.technicianJobId ?? e.id) === id
        );
        if (idx === -1) return [...prev, updatedEvent];
        const next = [...prev];
        next[idx] = { ...next[idx], ...updatedEvent };
        return next;
      });
      invalidateCurrentRange();
    },
    [invalidateCurrentRange]
  );

  useEffect(() => {
    const range = computeSchedulerFetchRange(viewMode, selectedDate);
    const rangeKey = `${schedulerFetchRangeKey(range)}|undated:${includeUndated}`;
    if (fetchRangeKeyRef.current === rangeKey && hasLoadedOnceRef.current) return;

    fetchRangeKeyRef.current = rangeKey;
    windowAbortRef.current?.abort();
    requestSeqRef.current += 1;

    paintFromCache(range);

    if (navDebounceRef.current) clearTimeout(navDebounceRef.current);
    navDebounceRef.current = setTimeout(() => {
      navDebounceRef.current = null;
      refreshData(range, { rangeKey });
    }, NAV_DEBOUNCE_MS);

    return () => {
      if (navDebounceRef.current) {
        clearTimeout(navDebounceRef.current);
        navDebounceRef.current = null;
      }
    };
  }, [viewMode, selectedDate, includeUndated, refreshData, paintFromCache]);

  useEffect(
    () => () => {
      windowAbortRef.current?.abort();
      if (navDebounceRef.current) clearTimeout(navDebounceRef.current);
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    },
    []
  );

  const isInitialLoad = loading && !hasLoadedOnceRef.current;
  const isRefreshing = loading && hasLoadedOnceRef.current;

  return {
    resources,
    setResources,
    events,
    setEvents,
    calendarEvents,
    undatedByTech,
    loading,
    isInitialLoad,
    isRefreshing,
    hasLoadedOnceRef,
    dataVersion,
    dataVersionRef,
    refreshData,
    invalidateCurrentRange,
    patchEvent,
    loadWindow,
    loadTechnicians,
  };
}

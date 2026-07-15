import { useEffect, useRef } from "react";
import { getSupabaseClient } from "../supabase/client";
import {
  invalidateAllWindowCaches,
  invalidateSchedulerCache,
  invalidateSchedulerServerCache,
  windowCacheKey,
  SCHEDULER_INVALIDATE_EVENT,
} from "./schedulerCache";
import { computeSchedulerFetchRange } from "./schedulerFetchRange";

const REALTIME_DEBOUNCE_MS = 5000;
/** Poll only when Realtime is disconnected — soft safety net. */
const POLL_INTERVAL_FALLBACK_MS = 3 * 60 * 1000;
/** Skip tab-focus refresh when a refresh ran within this window. */
const VISIBILITY_REFRESH_COOLDOWN_MS = 45 * 1000;

const CHANNEL_NAME = "fsm-scheduler-freshness";

function scheduledStartIntersectsRange(scheduledStart, range, includeUndated) {
  if (scheduledStart == null || scheduledStart === "") {
    return Boolean(includeUndated);
  }
  const ts = new Date(scheduledStart).getTime();
  if (Number.isNaN(ts)) return false;
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  return ts >= start && ts <= end;
}

/** True if the job row enter/leave/change affects the currently visible fetch window. */
function jobEventIntersectsCurrentRange(payload, range, includeUndated) {
  const candidates = [payload?.new?.scheduled_start, payload?.old?.scheduled_start];
  return candidates.some((start) =>
    scheduledStartIntersectsRange(start, range, includeUndated)
  );
}

/**
 * Supabase Realtime + visibility-aware polling fallback for cross-user freshness.
 * Subscribes once while enabled; date/view changes update refs (no channel rebuild).
 */
export function useSchedulerFreshness({
  viewMode,
  selectedDate,
  refreshData,
  enabled = true,
  includeUndated = false,
}) {
  const debounceRef = useRef(null);
  const pollRef = useRef(null);
  const realtimeConnectedRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  const viewModeRef = useRef(viewMode);
  const selectedDateRef = useRef(selectedDate);
  const includeUndatedRef = useRef(includeUndated);
  const refreshDataRef = useRef(refreshData);

  viewModeRef.current = viewMode;
  selectedDateRef.current = selectedDate;
  includeUndatedRef.current = includeUndated;
  refreshDataRef.current = refreshData;

  useEffect(() => {
    if (!enabled) return undefined;

    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    const invalidateCurrentWindow = () => {
      const currentRange = computeSchedulerFetchRange(
        viewModeRef.current,
        selectedDateRef.current
      );
      invalidateSchedulerCache(
        windowCacheKey(currentRange, includeUndatedRef.current)
      );
    };

    const runRefresh = ({ bustAllWindows = false, force = true } = {}) => {
      if (document.visibilityState !== "visible") return;
      if (force) {
        invalidateSchedulerServerCache();
      }
      if (bustAllWindows) {
        invalidateAllWindowCaches();
      } else if (force) {
        invalidateCurrentWindow();
      }
      const currentRange = computeSchedulerFetchRange(
        viewModeRef.current,
        selectedDateRef.current
      );
      lastRefreshAtRef.current = Date.now();
      refreshDataRef.current(currentRange, { force });
    };

    const scheduleRefresh = ({ force = false } = {}) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => runRefresh({ bustAllWindows: false, force }),
        REALTIME_DEBOUNCE_MS
      );
    };

    const onJobsChange = (payload) => {
      const range = computeSchedulerFetchRange(
        viewModeRef.current,
        selectedDateRef.current
      );
      if (
        !jobEventIntersectsCurrentRange(
          payload,
          range,
          includeUndatedRef.current
        )
      ) {
        return;
      }
      scheduleRefresh({ force: false });
    };

    const onTechnicianJobsChange = () => {
      // Assignment rows lack scheduled_start; soft-refresh the current window.
      scheduleRefresh({ force: false });
    };

    const onLocalInvalidate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      runRefresh({ bustAllWindows: true, force: true });
    };

    const clearPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const startPoll = () => {
      if (pollRef.current) return;
      pollRef.current = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        runRefresh({ bustAllWindows: false, force: false });
      }, POLL_INTERVAL_FALLBACK_MS);
    };

    const syncPollWithRealtime = (connected) => {
      realtimeConnectedRef.current = connected;
      if (connected) {
        clearPoll();
      } else {
        startPoll();
      }
    };

    const channel = supabase
      .channel(CHANNEL_NAME)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs",
        },
        onJobsChange
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "technician_jobs",
        },
        onTechnicianJobsChange
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          syncPollWithRealtime(true);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          syncPollWithRealtime(false);
          console.warn(
            "[Scheduler] Realtime unavailable, relying on polling fallback"
          );
        } else if (status === "CLOSED") {
          syncPollWithRealtime(false);
        }
      });

    // Until Realtime SUBSCRIBED, keep the fallback poll running.
    startPoll();

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < VISIBILITY_REFRESH_COOLDOWN_MS) return;
      runRefresh({ bustAllWindows: false, force: false });
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(SCHEDULER_INVALIDATE_EVENT, onLocalInvalidate);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearPoll();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(SCHEDULER_INVALIDATE_EVENT, onLocalInvalidate);
      supabase.removeChannel(channel);
      realtimeConnectedRef.current = false;
    };
  }, [enabled]);
}

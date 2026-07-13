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
import { toSingaporeYmd } from "../utils/singaporeDateTime";

const REALTIME_DEBOUNCE_MS = 5000;
const POLL_INTERVAL_REALTIME_MS = 3 * 60 * 1000;
const POLL_INTERVAL_FALLBACK_MS = 2 * 60 * 1000;
/** Skip tab-focus refresh when a refresh ran within this window. */
const VISIBILITY_REFRESH_COOLDOWN_MS = 45 * 1000;

/**
 * Supabase Realtime + visibility-aware polling fallback for cross-user freshness.
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

  useEffect(() => {
    if (!enabled) return undefined;

    const supabase = getSupabaseClient();
    if (!supabase) return undefined;

    const range = computeSchedulerFetchRange(viewMode, selectedDate);
    const rangeStart = range.start;
    const scheduleDateGte = toSingaporeYmd(rangeStart);

    const invalidateCurrentWindow = () => {
      const currentRange = computeSchedulerFetchRange(viewMode, selectedDate);
      invalidateSchedulerCache(windowCacheKey(currentRange, includeUndated));
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
      const currentRange = computeSchedulerFetchRange(viewMode, selectedDate);
      lastRefreshAtRef.current = Date.now();
      refreshData(currentRange, { force });
    };

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => runRefresh({ bustAllWindows: false, force: true }),
        REALTIME_DEBOUNCE_MS
      );
    };

    const onLocalInvalidate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      runRefresh({ bustAllWindows: true, force: true });
    };

    const restartPoll = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      const intervalMs = realtimeConnectedRef.current
        ? POLL_INTERVAL_REALTIME_MS
        : POLL_INTERVAL_FALLBACK_MS;
      pollRef.current = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        runRefresh({ bustAllWindows: true, force: false });
      }, intervalMs);
    };

    const channel = supabase
      .channel(`scheduler-changes-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs",
          filter: `scheduled_start=gte.${rangeStart}`,
        },
        scheduleRefresh
      );

    if (includeUndated) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs",
          filter: "scheduled_start=is.null",
        },
        scheduleRefresh
      );
    }

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "technician_jobs",
          filter: `updated_at=gte.${rangeStart}`,
        },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "job_schedule",
          filter: `jsdate=gte.${scheduleDateGte}`,
        },
        scheduleRefresh
      )
      .subscribe((status) => {
        const connected = status === "SUBSCRIBED";
        if (connected !== realtimeConnectedRef.current) {
          realtimeConnectedRef.current = connected;
          restartPoll();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          realtimeConnectedRef.current = false;
          restartPoll();
          console.warn("[Scheduler] Realtime unavailable, relying on polling fallback");
        }
      });

    restartPoll();

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
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(SCHEDULER_INVALIDATE_EVENT, onLocalInvalidate);
      supabase.removeChannel(channel);
    };
  }, [viewMode, selectedDate, refreshData, enabled, includeUndated]);
}

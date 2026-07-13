/**
 * Job status settings: defaults + fetch from Supabase.
 * For components that must avoid pulling in Supabase at load time,
 * import from utils/jobStatusDefaults.js instead.
 */

import { buildJobStatusesList } from "../lib/jobs/buildJobStatusesList";
import { readCachedDashboardBootstrap } from "./dashboardBootstrapCache";
import {
  formatJobStatusDisplayLabel,
  getDefaultJobStatuses,
  getJobStatusColorFromList,
  getJobStatusLabelFromList,
  readCachedJobStatuses,
  isJobStatusesCacheFresh,
  writeCachedJobStatuses,
  JOB_STATUS_CACHE_TTL_MS,
} from "./jobStatusDefaults";

export {
  formatJobStatusDisplayLabel,
  getDefaultJobStatuses,
  getJobStatusColorFromList,
  getJobStatusLabelFromList,
  readCachedJobStatuses,
  writeCachedJobStatuses,
  isJobStatusesCacheFresh,
  JOB_STATUS_CACHE_TTL_MS,
};

let fetchJobStatusesInFlight = null;

function settingsTypesToList(settingsTypes) {
  if (!settingsTypes || typeof settingsTypes !== "object" || Object.keys(settingsTypes).length === 0) {
    return [];
  }
  return Object.entries(settingsTypes)
    .map(([id, type]) => ({
      id,
      value: type.value ?? "",
      name: type.name ?? "",
      ...(type.color != null && String(type.color).trim() !== "" ? { color: type.color } : {}),
    }))
    .filter((s) => s.value !== undefined && s.value !== null && String(s.value).trim() !== "");
}

/**
 * Fetch job statuses: try SAP API (U_API_JOB_STATUS) first, then merge in Settings overrides.
 * Settings (Dashboard > Job Statuses) override name and color per status so you control colors.
 * Settings-only entries (extra values not returned by SAP) are appended unless the label already exists on an API row (avoids duplicate Confirmed/Unconfirmed/Cancelled, etc.).
 */
export const fetchJobStatuses = async ({ force = false } = {}) => {
  if (!force && isJobStatusesCacheFresh()) {
    const cached = readCachedJobStatuses();
    if (Array.isArray(cached) && cached.length > 0) return cached;
  }

  if (fetchJobStatusesInFlight) return fetchJobStatusesInFlight;

  fetchJobStatusesInFlight = (async () => {
    const { getDefaultJobStatuses } = await import("./jobStatusDefaults");

    let settingsTypes = null;
    let sapSnapshot = null;
    try {
      const bootstrapCached = !force ? readCachedDashboardBootstrap() : null;
      const bootstrapValue = bootstrapCached?.jobStatuses;
      if (bootstrapValue) {
        settingsTypes = bootstrapValue.types || null;
        sapSnapshot = Array.isArray(bootstrapValue.sapSnapshot) ? bootstrapValue.sapSnapshot : null;
      } else {
        const { getSupabaseClient } = await import("../lib/supabase/client");
        const supabase = getSupabaseClient();
        if (supabase) {
          const { data: settings, error } = await supabase
            .from("settings")
            .select("value")
            .eq("id", "jobStatuses")
            .single();
          if (!error && settings?.value) {
            settingsTypes = settings.value.types || null;
            sapSnapshot = Array.isArray(settings.value.sapSnapshot) ? settings.value.sapSnapshot : null;
          }
        }
      }
    } catch (e) {
      console.warn("Job statuses settings fetch failed:", e?.message);
    }

    const snapshotList =
      sapSnapshot?.length > 0
        ? buildJobStatusesList({ settingsTypes, sapRows: sapSnapshot })
        : [];

    if (!force && snapshotList.length > 0 && isJobStatusesCacheFresh()) {
      writeCachedJobStatuses(snapshotList);
      return snapshotList;
    }

    try {
      const res = await fetch("/api/getJobStatus", { method: "GET", credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const apiList = buildJobStatusesList({ settingsTypes, sapRows: data });
          if (apiList.length > 0) {
            writeCachedJobStatuses(apiList);
            return apiList;
          }
        }
      }
    } catch (err) {
      console.warn("Job statuses from API failed, falling back to settings:", err?.message);
    }

    if (snapshotList.length > 0) {
      writeCachedJobStatuses(snapshotList);
      return snapshotList;
    }

    const fromSettings = settingsTypesToList(settingsTypes);
    if (fromSettings.length > 0) return fromSettings;

    return getDefaultJobStatuses();
  })();

  try {
    return await fetchJobStatusesInFlight;
  } finally {
    fetchJobStatusesInFlight = null;
  }
};

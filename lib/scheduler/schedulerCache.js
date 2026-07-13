import { schedulerFetchRangeKey } from "./schedulerFetchRange";

const SESSION_PREFIX = "fsm_scheduler_cache_v2";
const TECHNICIANS_KEY = `${SESSION_PREFIX}:technicians`;
const WINDOW_PREFIX = `${SESSION_PREFIX}:window:`;

/** Windowed job/event data TTL (ms). */
export const WINDOW_DATA_TTL_MS = 90 * 1000;

/** Technicians + employee schedules TTL (ms). */
export const STATIC_TECH_TTL_MS = 15 * 60 * 1000;

/** Skip client background revalidate when cache is newer than this (aligns with API max-age=30). */
export const REVALIDATE_MIN_INTERVAL_MS = 30 * 1000;

const memoryCache = new Map();

/** Per-window job site contact meta (jobId → fields), keyed by scheduler rangeKey. */
const siteContactByRange = new Map();

function pickSiteContactMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const picked = {
    siteContactName: meta.siteContactName ?? "",
    siteContactPhone: meta.siteContactPhone ?? "",
    siteContactMobile: meta.siteContactMobile ?? "",
    siteContactEmail: meta.siteContactEmail ?? "",
    siteContactId: meta.siteContactId ?? null,
  };
  if (typeof meta.siteContactExtraCount === "number") {
    picked.siteContactExtraCount = meta.siteContactExtraCount;
  }
  return picked;
}

function readSessionEntry(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionEntry(key, entry) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* ignore quota */
  }
}

function removeSessionEntry(key) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function isFresh(fetchedAt, ttlMs) {
  return typeof fetchedAt === "number" && Date.now() - fetchedAt < ttlMs;
}

export function techniciansCacheKey() {
  return TECHNICIANS_KEY;
}

export function windowCacheKey(range, includeUndated = false) {
  const base = schedulerFetchRangeKey(range);
  return includeUndated ? `${WINDOW_PREFIX}${base}:undated` : `${WINDOW_PREFIX}${base}`;
}

function readSchedulerCacheEntry(key, ttlMs) {
  const mem = memoryCache.get(key);
  if (mem && isFresh(mem.fetchedAt, ttlMs)) {
    return mem;
  }

  const session = readSessionEntry(key);
  if (session && isFresh(session.fetchedAt, ttlMs)) {
    memoryCache.set(key, session);
    return session;
  }

  return null;
}

export function readSchedulerCache(key, ttlMs) {
  return readSchedulerCacheEntry(key, ttlMs)?.data ?? null;
}

/** Returns fetchedAt (ms) when a fresh cache entry exists, else null. */
export function getSchedulerCacheFetchedAt(key, ttlMs) {
  return readSchedulerCacheEntry(key, ttlMs)?.fetchedAt ?? null;
}

export function writeSchedulerCache(key, data) {
  const entry = { fetchedAt: Date.now(), data };
  memoryCache.set(key, entry);
  writeSessionEntry(key, entry);
}

export function invalidateSchedulerCache(key) {
  memoryCache.delete(key);
  removeSessionEntry(key);
}

export const SCHEDULER_INVALIDATE_EVENT = "fsm:scheduler-invalidate";

/** Notify open scheduler tabs to drop window caches and revalidate. */
export function dispatchSchedulerInvalidate() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCHEDULER_INVALIDATE_EVENT));
}

/**
 * Bust server-side scheduler window cache (mirrors jobs list invalidate).
 * Returns a Promise so callers can await before refetching.
 * @returns {Promise<void>}
 */
export function invalidateSchedulerServerCache() {
  if (typeof window === "undefined") return Promise.resolve();
  return fetch("/api/scheduler/invalidate-cache", {
    method: "POST",
    credentials: "same-origin",
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function invalidateAllWindowCaches() {
  if (typeof window !== "undefined") {
    try {
      const keysToRemove = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const k = window.sessionStorage.key(i);
        if (k?.startsWith(WINDOW_PREFIX)) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }
  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(WINDOW_PREFIX)) memoryCache.delete(key);
  }
  siteContactByRange.clear();
}

export function getSiteContactFromCache(rangeKey, jobId) {
  if (!rangeKey || !jobId) return null;
  return siteContactByRange.get(rangeKey)?.get(String(jobId)) ?? null;
}

export function setSiteContactCache(rangeKey, jobId, meta) {
  if (!rangeKey || !jobId || !meta || typeof meta !== "object") return;
  const picked = pickSiteContactMeta(meta);
  if (!picked) return;
  let byJob = siteContactByRange.get(rangeKey);
  if (!byJob) {
    byJob = new Map();
    siteContactByRange.set(rangeKey, byJob);
  }
  byJob.set(String(jobId), picked);
}

/** Seed client site-contact map from pre-resolved event meta (window load). */
export function seedSiteContactCacheFromEvents(rangeKey, events = []) {
  if (!rangeKey || !Array.isArray(events)) return;
  for (const evt of events) {
    const m = evt?.meta;
    if (!evt?.jobId || !m?.siteContactResolved) continue;
    setSiteContactCache(rangeKey, evt.jobId, m);
  }
}

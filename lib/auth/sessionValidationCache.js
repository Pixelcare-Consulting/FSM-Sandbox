/** Short-TTL in-memory cache for validated sessions (reduces DB load on API routes). */

const SESSION_CACHE_TTL_MS = 100 * 1000;
const cache = new Map();
/** @type {Map<string, Promise<unknown>>} */
const inFlightFetches = new Map();

function cacheKey(uid, sessionId) {
  return `${uid}:${sessionId}`;
}

export function getCachedSessionUser(uid, sessionId) {
  if (!uid || !sessionId) return null;
  const entry = cache.get(cacheKey(uid, sessionId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(cacheKey(uid, sessionId));
    return null;
  }
  return entry.user;
}

export function setCachedSessionUser(uid, sessionId, user) {
  if (!uid || !sessionId || !user) return;
  cache.set(cacheKey(uid, sessionId), {
    user,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

export function invalidateCachedSessionUser(uid, sessionId) {
  if (uid && sessionId) {
    const key = cacheKey(uid, sessionId);
    cache.delete(key);
    inFlightFetches.delete(key);
    return;
  }
  if (!uid) return;
  const prefix = `${uid}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
  for (const key of inFlightFetches.keys()) {
    if (key.startsWith(prefix)) {
      inFlightFetches.delete(key);
    }
  }
}

/**
 * Deduplicate concurrent session DB lookups for the same uid:sessionId pair.
 *
 * @template T
 * @param {string} uid
 * @param {string} sessionId
 * @param {() => Promise<T>} fetchFn
 * @returns {Promise<T>}
 */
export function resolveSessionUserWithDedupe(uid, sessionId, fetchFn) {
  if (!uid || !sessionId) {
    return fetchFn();
  }

  const key = cacheKey(uid, sessionId);
  const existing = inFlightFetches.get(key);
  if (existing) {
    return existing;
  }

  const promise = fetchFn().finally(() => {
    inFlightFetches.delete(key);
  });
  inFlightFetches.set(key, promise);
  return promise;
}

/** @deprecated Use resolveSessionUserWithDedupe */
export const dedupeSessionFetch = resolveSessionUserWithDedupe;

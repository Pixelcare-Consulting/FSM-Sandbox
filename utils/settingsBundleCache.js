const SETTINGS_BUNDLE_CACHE_KEY = 'settingsBundle';
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

function readCacheEntry() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SETTINGS_BUNDLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.timestamp) return null;
    if (Date.now() - parsed.timestamp > CACHE_DURATION_MS) {
      sessionStorage.removeItem(SETTINGS_BUNDLE_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function readCachedSettingsBundle() {
  return readCacheEntry();
}

export function writeCachedSettingsBundle(data) {
  if (typeof window === 'undefined' || !data) return;
  try {
    sessionStorage.setItem(
      SETTINGS_BUNDLE_CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch {
    // ignore quota errors
  }
}

export function invalidateSettingsBundleCache() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(SETTINGS_BUNDLE_CACHE_KEY);
  } catch {
    // ignore
  }
}

/** Bust server-side settings + dashboard bootstrap list caches. */
export function invalidateSettingsServerCache() {
  if (typeof window === 'undefined') return;
  void fetch('/api/settings/invalidate-cache', {
    method: 'POST',
    credentials: 'same-origin',
  }).catch(() => {});
}

export async function fetchSettingsBundleFromApi({ force = false } = {}) {
  if (!force) {
    const cached = readCachedSettingsBundle();
    if (cached) return cached;
  }

  const res = await fetch('/api/settings/bundle', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Settings bundle request failed (${res.status})`);
  }

  const data = await res.json();
  writeCachedSettingsBundle(data);
  return data;
}

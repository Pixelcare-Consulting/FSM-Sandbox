import { writeCachedSettingsBundle } from './settingsBundleCache';

const DASHBOARD_BOOTSTRAP_CACHE_KEY = 'dashboardBootstrap';
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export const DASHBOARD_BOOTSTRAP_QUERY_KEY = ['dashboard-bootstrap'];

function readCacheEntry() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DASHBOARD_BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.timestamp) return null;
    if (Date.now() - parsed.timestamp > CACHE_DURATION_MS) {
      sessionStorage.removeItem(DASHBOARD_BOOTSTRAP_CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function readCachedDashboardBootstrap() {
  return readCacheEntry();
}

export function writeCachedDashboardBootstrap(data) {
  if (typeof window === 'undefined' || !data) return;
  try {
    sessionStorage.setItem(
      DASHBOARD_BOOTSTRAP_CACHE_KEY,
      JSON.stringify({ data, timestamp: Date.now() })
    );
    // Keep settings bundle cache in sync for companyCache / legacy readers.
    writeCachedSettingsBundle({
      companyInfo: data.companyInfo ?? null,
      jobStatuses: data.jobStatuses ?? null,
      followUp: data.followUp ?? null,
      fetchedAt: data.fetchedAt,
    });
  } catch {
    // ignore quota errors
  }
}

export function invalidateDashboardBootstrapCache() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(DASHBOARD_BOOTSTRAP_CACHE_KEY);
  } catch {
    // ignore
  }
}

export async function fetchDashboardBootstrapFromApi({ force = false } = {}) {
  if (!force) {
    const cached = readCachedDashboardBootstrap();
    if (cached) return cached;
  }

  const res = await fetch('/api/session/bootstrap', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Dashboard bootstrap request failed (${res.status})`);
  }

  const data = await res.json();
  writeCachedDashboardBootstrap(data);
  return data;
}

import { invalidateDashboardBootstrapCache } from './dashboardBootstrapCache';
import { invalidateSettingsBundleCache } from './settingsBundleCache';

/** Clear client session caches and bust server reference caches after settings writes. */
export async function invalidateSettingsCachesClient() {
  invalidateDashboardBootstrapCache();
  invalidateSettingsBundleCache();
  try {
    await fetch('/api/settings/invalidate-cache', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // non-blocking
  }
}

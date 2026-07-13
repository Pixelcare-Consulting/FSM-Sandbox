import { invalidateListCache } from './listQueryHelpers';

export const SETTINGS_BUNDLE_CACHE_KEY = 'settings-bundle';

const DASHBOARD_BOOTSTRAP_PREFIX = 'dashboard-bootstrap:';

/** Bust server-side reference caches after settings mutations. */
export function invalidateReferenceCaches() {
  invalidateListCache(SETTINGS_BUNDLE_CACHE_KEY);
  invalidateListCache(DASHBOARD_BOOTSTRAP_PREFIX);
}

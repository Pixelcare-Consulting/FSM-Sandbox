/**
 * Session Configuration
 * Central configuration for session management and auto-logout behavior
 */

const SESSION_CONFIG = {
  // SAP B1 Session Duration (set by SAP Service Layer)
  SESSION_DURATION_MINUTES: 30,
  SESSION_DURATION_MS: 30 * 60 * 1000, // 30 minutes
  
  // Idle timeout: force logout after this many minutes of no user activity
  IDLE_TIMEOUT_MINUTES: 60,
  IDLE_TIMEOUT_MS: 60 * 60 * 1000, // 60 minutes
  
  // Auto-logout threshold (when to show warnings and force logout)
  // Session will auto-renew when less than 5 minutes remain
  AUTO_RENEW_THRESHOLD_MINUTES: 5,
  AUTO_RENEW_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
  
  // Renewal check interval (how often to check if renewal is needed)
  RENEWAL_CHECK_INTERVAL_MS: 60 * 1000, // 60 seconds (staggered vs 30s getUserInfo poll)
  
  // Minimum time between renewal attempts (prevents renewal spam)
  MIN_RENEWAL_INTERVAL_MS: 2 * 60 * 1000, // 2 minutes
  
  // Middleware grace period (prevents auto-logout during cookie propagation)
  MIDDLEWARE_GRACE_PERIOD_MS: 30 * 1000, // 30 seconds
  
  // Cookie settings
  COOKIE_SETTINGS: {
    secure: true,
    sameSite: 'lax',
    path: '/'
  }
};

// Calculate when auto-logout will occur
export function getAutoLogoutTime(sessionStartTime) {
  return new Date(sessionStartTime + SESSION_CONFIG.SESSION_DURATION_MS);
}

// Check if session needs renewal
export function needsRenewal(expiryTime) {
  const timeUntilExpiry = expiryTime - Date.now();
  return timeUntilExpiry < SESSION_CONFIG.AUTO_RENEW_THRESHOLD_MS && timeUntilExpiry > 0;
}

// Check if session is expired
export function isSessionExpired(expiryTime) {
  const timeUntilExpiry = expiryTime - Date.now();
  // Include grace period to prevent false positives during renewals
  return timeUntilExpiry < -SESSION_CONFIG.MIDDLEWARE_GRACE_PERIOD_MS;
}

export default SESSION_CONFIG;


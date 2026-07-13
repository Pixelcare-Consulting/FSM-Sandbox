import { toast } from 'react-hot-toast';
import Cookies from 'js-cookie';

export async function logMiddlewareActivity(activity, path) {
  try {
    const response = await fetch('/api/logMiddlewareActivity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        activity,
        timestamp: new Date().toISOString(),
        workerId: document.cookie.split(';')
          .find(c => c.trim().startsWith('workerId='))
          ?.split('=')[1] || 'UNKNOWN',
        path
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to log activity: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Failed to log middleware activity:', error);
  }
}

export async function checkAndRenewSession() {
  try {
    const expiryTimeStr = Cookies.get('B1SESSION_EXPIRY');
    if (!expiryTimeStr) return;
    
    const expiryTime = new Date(expiryTimeStr).getTime();
    if (isNaN(expiryTime)) return;

    const timeRemaining = expiryTime - Date.now();
    
    // If less than 5 minutes remaining, renew session silently
    if (timeRemaining < 5 * 60 * 1000) {
      console.log('🔄 Silent session renewal initiated');
      const response = await fetch('/api/renewSAPB1Session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        console.error('❌ Silent session renewal failed');
        return;
      }

      const data = await response.json();
      
      // Immediately update cookie if renewal was successful
      // Match server's security settings (only Secure if HTTPS)
      if (data.success && data.expiryTime) {
        const expiryDate = new Date(data.expiryTime);
        const isSecure = window.location.protocol === 'https:';
        Cookies.set('B1SESSION_EXPIRY', expiryDate.toISOString(), {
          expires: expiryDate,
          secure: isSecure, // Only set Secure flag if actually over HTTPS
          sameSite: 'lax',
          path: '/'
        });
        // Recalculate time remaining with new expiry
        const newExpiryTime = expiryDate.getTime();
        const newTimeRemaining = newExpiryTime - Date.now();
        console.log('✅ Session renewed silently, updated expiry');
        return formatTimeRemaining(newTimeRemaining);
      }
      
      console.log('✅ Session renewed silently', data);
    }

    return formatTimeRemaining(timeRemaining);
  } catch (error) {
    console.error('❌ Error in session check:', error);
  }
}

export async function validateSession() {
  console.log('🔍 Validating session...');
  
  // Add a small delay to allow cookies to be set
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {});

    console.log('📊 Current cookies:', cookies);

    // Check for essential cookies only
    const essentialCookies = [
      'uid',
      'workerId',
      'email'
    ];

    const missingCookies = essentialCookies.filter(
      cookieName => !cookies[cookieName]
    );

    if (missingCookies.length > 0) {
      console.log('⚠️ Missing essential cookies:', missingCookies);
      return false;
    }

    // If we have essential cookies but missing B1SESSION, wait a bit longer
    if (!cookies.B1SESSION || !cookies.B1SESSION_EXPIRY) {
      console.log('⏳ Waiting for B1SESSION cookies...');
      return true; // Return true to prevent immediate logout
    }

    console.log('✅ All cookies present');
    return true;
  } catch (error) {
    console.error('❌ Session validation error:', error);
    return true; // Return true to prevent immediate logout on error
  }
}

export const formatTimeRemaining = (timeRemaining) => {
  // Return empty string if time is not valid - prevents negative timer spam
  if (!timeRemaining || isNaN(timeRemaining) || timeRemaining <= 0) {
    return '00:00:00';
  }

  const totalSeconds = Math.floor(timeRemaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * @deprecated Session renewal is owned by ActivityTracker in pages/_app.js.
 * Do not import in new code.
 */
export function initializeSessionTimer(_setTimeRemaining) {
  return () => {};
}

export async function logActivity(activity, details = {}) {
  try {
    const baseUrl = window.location.origin; // Get the base URL of your application
    const response = await fetch(`${baseUrl}/api/logActivity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        activity,
        timestamp: new Date().toISOString(),
        ...details
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to log activity: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

// Initialize session renewal check
/**
 * @deprecated Session renewal is owned by ActivityTracker in pages/_app.js.
 * Do not import in new code.
 */
export const initializeSessionRenewalCheck = (_router) => {
  return () => {};
};

/**
 * Handle session errors with grace period
 * 
 * IMPORTANT: This function should only be called as a last resort.
 * It will clear all cookies and redirect to sign-in.
 * 
 * Before calling this, ensure:
 * 1. Session has been expired for more than grace period
 * 2. Session renewal has failed multiple times
 * 3. No other recovery options available
 * 
 * @param {Router} router - Next.js router instance
 * @param {Object} options - Options for session error handling
 * @param {boolean} options.immediate - Skip grace period and logout immediately
 * @param {string} options.reason - Reason for logout (for logging)
 */
export const handleSessionError = (router, options = {}) => {
  const { immediate = false, reason = 'Unknown' } = options;
  
  console.log('🚨 [handleSessionError] Session error detected', {
    reason,
    immediate,
    pathname: router?.pathname
  });
  
  // Add grace period check - don't immediately logout
  if (!immediate) {
    const expiryTimeStr = Cookies.get('B1SESSION_EXPIRY');
    const b1Session = Cookies.get('B1SESSION');
    
    // If session cookies still exist, verify they're actually expired
    if (expiryTimeStr && b1Session) {
      try {
        const expiryTime = new Date(expiryTimeStr).getTime();
        const now = Date.now();
        const timeUntilExpiry = expiryTime - now;
        
        // Grace period: Allow 30 seconds for cookie propagation/sync issues
        const GRACE_PERIOD_MS = 30 * 1000;
        
        if (timeUntilExpiry > -GRACE_PERIOD_MS) {
          console.log('⏳ [handleSessionError] Within grace period, not logging out', {
            timeUntilExpiry: Math.floor(timeUntilExpiry / 1000) + 's',
            gracePeriod: GRACE_PERIOD_MS / 1000 + 's'
          });
          return; // Don't logout yet
        }
        
        console.log('⏰ [handleSessionError] Session expired beyond grace period', {
          expiredFor: Math.floor(Math.abs(timeUntilExpiry) / 1000) + 's',
          gracePeriod: GRACE_PERIOD_MS / 1000 + 's'
        });
      } catch (error) {
        console.error('❌ [handleSessionError] Error checking expiry time:', error);
        // Continue with logout if we can't parse expiry
      }
    }
  }
  
  // Log the logout event
  console.warn('🔓 [handleSessionError] Proceeding with logout', {
    reason,
    immediate,
    timestamp: new Date().toISOString()
  });
  
  // Clear all cookies
  const cookies = document.cookie.split(';');
  const cookieNames = [];
  
  cookies.forEach(cookie => {
    const [name] = cookie.split('=');
    const trimmedName = name.trim();
    if (trimmedName) {
      cookieNames.push(trimmedName);
      // Clear with multiple methods to ensure removal
      document.cookie = `${trimmedName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      document.cookie = `${trimmedName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
    }
  });
  
  console.log('🧹 [handleSessionError] Cleared cookies:', cookieNames);

  // Show user-friendly message before redirect
  const message = immediate 
    ? 'Session ended. Redirecting to sign-in...'
    : 'Session expired. Redirecting to sign-in...';
    
  // Use setTimeout to ensure cookie clearing completes
  setTimeout(() => {
    console.log('↪️ [handleSessionError] Redirecting to sign-in page');
    window.location.href = '/sign-in';
  }, 100);
};

// Update session time display
export const updateSessionTimeDisplay = (timeRemaining) => {
  const formattedTime = formatTimeRemaining(timeRemaining);
  document.body.setAttribute('data-session-time', formattedTime);
};
import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Cookies from 'js-cookie';
import SESSION_CONFIG from '../config/session.config';
import { useIdleTimeout } from '../hooks/useIdleTimeout';
import {
  coordinatedSessionLogout,
  shouldLogoutOnAuthError,
  isLogoutInProgress,
  sleep,
  isWithinPostLoginGrace,
  tryAcquireSessionProbe,
} from '../lib/auth/sessionTabSync';

/**
 * ActivityTracker - Primary Session Management Component
 * 
 * This component is the SINGLE SOURCE OF TRUTH for session renewal.
 * It handles:
 * - Automatic session renewal when session is about to expire
 * - Idle timeout logout after configured idle period of no user activity
 * - Session expiry warnings (without forcing logout)
 * - Tab focus detection for session checks
 * 
 * Important: This is the only active session manager. Other hooks like
 * useSessionRenewal are deprecated and should not force logout.
 */

// Stagger renewal polls (60s) vs getUserInfo session check (30s)
const RENEWAL_POLL_INTERVAL_MS = 60 * 1000;

// Module-level lock to prevent duplicate renewals across all component instances
let globalRenewalInProgress = false;
let globalLastRenewalTime = 0;

async function postRenewalSession(body) {
  return fetch('/api/renewSAPB1Session', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function handleRenewal401(response, now, lastWarningTime) {
  const errData = await response.json().catch(() => ({}));
  if (!errData.requiresLogin || isLogoutInProgress()) return;

  if (isWithinPostLoginGrace(Cookies.get)) {
    await sleep(2000);
    const retryResponse = await postRenewalSession({
      currentSession: null,
      currentRouteId: null,
    });
    if (retryResponse.ok) {
      return retryResponse;
    }
  }

  const decision = await shouldLogoutOnAuthError(errData, Cookies.get);

  if (!decision.logout) {
    if (now - lastWarningTime.current > 2 * 60 * 1000) {
      toast.warning('Session check failed temporarily. Your session is still active — please save your work.', {
        toastId: 'activity-tracker-session-retry',
        duration: 8000,
        icon: '⚠️',
        position: 'top-right',
      });
      lastWarningTime.current = now;
    }
    return null;
  }

  const message = decision.message || 'Session expired. Another device may have logged in.';
  await coordinatedSessionLogout({
    message,
    reason: 'activity_tracker_renewal_401',
    redirect: (msg) => {
      window.location.href = '/sign-in?toast=' + encodeURIComponent(msg);
    },
  });
  return null;
}

function applyRenewalExpiryCookie(data) {
  if (!data?.success || !data.expiryTime) return false;

  const expiryDate = new Date(data.expiryTime);
  const maxAgeSeconds = 30 * 60;
  const expiresDate = new Date(Date.now() + maxAgeSeconds * 1000);
  const isSecure = window.location.protocol === 'https:';

  Cookies.set('B1SESSION_EXPIRY', expiryDate.toISOString(), {
    expires: expiresDate,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
  });
  return true;
}

const ActivityTracker = () => {
  const router = useRouter();
  useIdleTimeout();
  const pathnameRef = useRef(router.pathname);
  pathnameRef.current = router.pathname;
  const renewalInProgress = useRef(false);
  const lastRenewalTime = useRef(0);
  const lastWarningTime = useRef(0);
  const renewalAttempts = useRef(0);

  const checkAndRenewSession = useCallback(async () => {
    if (!pathnameRef.current.includes('/dashboard')) return;
    // Skip if on authentication pages
    if (pathnameRef.current.includes('/authentication') || pathnameRef.current === '/sign-in') {
      return;
    }

    // Prevent concurrent renewals - check FIRST before any async operations
    // Check both component-level and global-level locks for early exit
    if (renewalInProgress.current || globalRenewalInProgress) {
    //  console.log('🔄 [ActivityTracker] Renewal already in progress (early check), skipping...');
      return;
    }
    
    const now = Date.now();
    
    // Prevent renewal spam - wait minimum interval between renewals
    // Check both component-level and global-level timestamps
    if (now - lastRenewalTime.current < SESSION_CONFIG.MIN_RENEWAL_INTERVAL_MS ||
        now - globalLastRenewalTime < SESSION_CONFIG.MIN_RENEWAL_INTERVAL_MS) {
   //   console.log('⏱️ [ActivityTracker] Too soon since last renewal, skipping...');
      return;
    }

    try {
      // Check if session is close to expiry
      const expiryTimeStr = Cookies.get('B1SESSION_EXPIRY');
      
      // If no expiry cookie, check if user is logged in at all
      if (!expiryTimeStr) {
        const uid = Cookies.get('uid');
        const sessionId = Cookies.get('sessionId');

        // Logged in (uid + sessionId) but expiry missing — trigger renewal (B1SESSION is HttpOnly)
        if (uid && sessionId) {
        //  console.log('🔄 [ActivityTracker] User logged in but session cookies missing - triggering renewal');
          
          // Check if renewal is already in progress
          if (renewalInProgress.current || globalRenewalInProgress) {
          //  console.log('🔄 [ActivityTracker] Renewal already in progress, skipping...');
            return;
          }
          
          // Check if we've tried recently (prevent spam)
          if (now - lastRenewalTime.current < SESSION_CONFIG.MIN_RENEWAL_INTERVAL_MS) {
           // console.log('⏱️ [ActivityTracker] Renewal too recent, skipping...');
            return;
          }
          
          // Trigger renewal to create missing session cookies
          try {
            if (!tryAcquireSessionProbe()) return;

            renewalInProgress.current = true;
            globalRenewalInProgress = true;
            lastRenewalTime.current = now;
            globalLastRenewalTime = now;
            renewalAttempts.current += 1;

            // console.log(`🔄 [ActivityTracker] Starting session creation attempt #${renewalAttempts.current}...`, {
            //   hasUid: !!uid,
            //   hasB1Session: false,
            //   timestamp: new Date().toISOString()
            // });

            const response = await postRenewalSession({
              currentSession: null,
              currentRouteId: null,
            });

            if (!response.ok) {
              if (response.status === 401) {
                const retryResult = await handleRenewal401(response, now, lastWarningTime);
                if (retryResult?.ok) {
                  const data = await retryResult.json();
                  if (applyRenewalExpiryCookie(data)) {
                    renewalAttempts.current = 0;
                    toast.success('Session restored successfully', {
                      toastId: 'session-renewed',
                      duration: 3000,
                      icon: '✅',
                      position: 'bottom-right'
                    });
                  }
                }
                return;
              }
              throw new Error(`Session creation failed with status: ${response.status}`);
            }

            const data = await response.json();

            if (applyRenewalExpiryCookie(data)) {
              renewalAttempts.current = 0;
              toast.success('Session restored successfully', {
                toastId: 'session-renewed',
                duration: 3000,
                icon: '✅',
                position: 'bottom-right'
              });
            }
          } catch (error) {
            console.error('❌ [ActivityTracker] Session creation error:', error);
            // Show warning but don't spam
            if (now - lastWarningTime.current > 5 * 60 * 1000) {
              toast.error('Failed to restore session. Please refresh the page.', {
                toastId: 'activity-tracker-session-restore-failed',
                duration: 8000,
                icon: '⚠️',
                position: 'top-right'
              });
              lastWarningTime.current = now;
            }
          } finally {
            setTimeout(() => {
              renewalInProgress.current = false;
              globalRenewalInProgress = false;
            }, 1000);
          }
          return; // Exit after attempting renewal
        }
        
        // Identity cookies exist but expiry missing
        if (uid || sessionId) {
          console.warn('⚠️ [ActivityTracker] Session cookies exist but B1SESSION_EXPIRY missing');
          // Don't spam warnings - only show once per 5 minutes
          if (now - lastWarningTime.current > 5 * 60 * 1000) {
            toast.warning('Session information incomplete. Please refresh the page.', {
              duration: 6000,
              icon: '⚠️'
            });
            lastWarningTime.current = now;
          }
        }
        return; // No session cookie, skip silently
      }
      
      const expiryTime = new Date(expiryTimeStr).getTime();
      if (isNaN(expiryTime)) {
        console.error('❌ [ActivityTracker] Invalid expiry time format:', expiryTimeStr);
        return; // Invalid expiry time
      }
      
      const timeUntilExpiry = expiryTime - now;
      const renewalThreshold = SESSION_CONFIG.AUTO_RENEW_THRESHOLD_MS;
      
      // Log current session status
      const minutesRemaining = Math.floor(timeUntilExpiry / 60000);
      //console.log(`⏱️ [ActivityTracker] Session status: ${minutesRemaining} minutes remaining`);
      
      // If session expired, show warning but don't force logout
      if (timeUntilExpiry <= 0) {
        // Only show expiry warning once per 5 minutes to avoid spam
        if (now - lastWarningTime.current > 5 * 60 * 1000) {
          console.warn('⚠️ [ActivityTracker] Session expired, but not forcing logout');
          toast.error('Session expired. Please save your work and refresh to re-login.', {
            duration: 10000,
            icon: '⏰',
            position: 'top-right'
          });
          lastWarningTime.current = now;
        }
        return;
      }
      
      // Trigger renewal if within threshold
      // Set flag IMMEDIATELY to prevent race conditions with concurrent calls
      if (timeUntilExpiry <= renewalThreshold) {
        // Check both component-level and global-level locks to prevent duplicate renewals
        if (renewalInProgress.current || globalRenewalInProgress) {
        //  console.log('🔄 [ActivityTracker] Renewal already in progress (component or global), skipping...');
          return;
        }
        
        // Check global last renewal time to prevent rapid successive calls
        if (now - globalLastRenewalTime < SESSION_CONFIG.MIN_RENEWAL_INTERVAL_MS) {
         // console.log('⏱️ [ActivityTracker] Global renewal too recent, skipping...');
          return;
        }
        
        // CRITICAL: Check if we still have uid cookie before attempting renewal
        // If uid is missing, renewal will fail and we'll lose the session
        const uid = Cookies.get('uid');
        if (!uid) {
          console.error('❌ [ActivityTracker] CRITICAL: uid cookie missing before renewal attempt!', {
            minutesRemaining,
            timeUntilExpiry,
            hasSessionId: !!Cookies.get('sessionId'),
            hasExpiry: !!expiryTimeStr,
            timestamp: new Date().toISOString()
          });
          
          // Show urgent warning to user
          if (now - lastWarningTime.current > 2 * 60 * 1000) { // Every 2 minutes
            toast.error('Session cookies expired. Please save your work and refresh the page to re-login.', {
              duration: 15000,
              icon: '🚨',
              position: 'top-right'
            });
            lastWarningTime.current = now;
          }
          return; // Can't renew without uid
        }
        
        // Set flags immediately before any async operations (both component and global)
        if (!tryAcquireSessionProbe()) return;

        renewalInProgress.current = true;
        globalRenewalInProgress = true;
        lastRenewalTime.current = now;
        globalLastRenewalTime = now;
        renewalAttempts.current += 1;

        // console.log(`🔄 [ActivityTracker] Starting renewal attempt #${renewalAttempts.current}...`, {
        //   minutesRemaining,
        //   hasUid: !!uid,
        //   hasB1Session: !!Cookies.get('B1SESSION'),
        //   timestamp: new Date().toISOString()
        // });

        const response = await postRenewalSession({
          currentSession: null,
          currentRouteId: null,
        });

        if (!response.ok) {
          if (response.status === 401) {
            const retryResult = await handleRenewal401(response, now, lastWarningTime);
            if (retryResult?.ok) {
              const data = await retryResult.json();
              if (applyRenewalExpiryCookie(data)) {
                renewalAttempts.current = 0;
                if (data.message === 'Session renewed successfully') {
                  toast.success('Session renewed successfully', {
                    toastId: 'session-renewed',
                    duration: 3000,
                    icon: '✅',
                    position: 'bottom-right'
                  });
                }
              }
            }
            return;
          }
          throw new Error(`Session renewal failed with status: ${response.status}`);
        }

        const data = await response.json();

        if (applyRenewalExpiryCookie(data)) {
          renewalAttempts.current = 0;
          if (data.message === 'Session renewed successfully') {
            toast.success('Session renewed successfully', {
              toastId: 'session-renewed',
              duration: 3000,
              icon: '✅',
              position: 'bottom-right'
            });
          }
        } else {
          console.warn('⚠️ [ActivityTracker] Renewal response received but success flag not set');
        }
      }
    } catch (error) {
      console.error('❌ [ActivityTracker] Session renewal error:', {
        error: error.message,
        stack: error.stack,
        attempt: renewalAttempts.current,
        hasUid: !!Cookies.get('uid'),
        hasSessionId: !!Cookies.get('sessionId'),
        hasExpiry: !!Cookies.get('B1SESSION_EXPIRY'),
        timestamp: new Date().toISOString()
      });
      
      // Don't force logout on renewal failure - just show warning
      const expiryTimeStr = Cookies.get('B1SESSION_EXPIRY');
      const uid = Cookies.get('uid');
      const sessionId = Cookies.get('sessionId');
      
      // Check if uid is missing - this is critical
      if (!uid) {
        console.error('🚨 [ActivityTracker] CRITICAL: uid cookie missing after renewal error!', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
        
        // Show urgent warning
        if (Date.now() - lastWarningTime.current > 2 * 60 * 1000) {
          toast.error('Session authentication lost. Please save your work and refresh to re-login.', {
            duration: 15000,
            icon: '🚨',
            position: 'top-right'
          });
          lastWarningTime.current = Date.now();
        }
      } else if (!expiryTimeStr || !sessionId) {
        console.warn('⚠️ [ActivityTracker] Session cookies missing after renewal error', {
          hasUid: true,
          hasSessionId: !!sessionId,
          hasExpiry: !!expiryTimeStr
        });
        // Only show warning once per 5 minutes
        if (Date.now() - lastWarningTime.current > 5 * 60 * 1000) {
          toast.error('Session may have expired. Please save your work and refresh the page.', {
            duration: 8000,
            icon: '⚠️',
            position: 'top-right'
          });
          lastWarningTime.current = Date.now();
        }
      } else {
        // Check if session is actually expired
        const expiryTime = new Date(expiryTimeStr).getTime();
        const timeUntilExpiry = expiryTime - Date.now();
        
        if (timeUntilExpiry <= 0) {
          console.warn('⚠️ [ActivityTracker] Session expired after renewal error');
          // Only show warning once per 5 minutes
          if (Date.now() - lastWarningTime.current > 5 * 60 * 1000) {
            toast.error('Session expired. Please save your work and refresh to re-login.', {
              duration: 10000,
              icon: '⏰',
              position: 'top-right'
            });
            lastWarningTime.current = Date.now();
          }
        } else {
          // Session still valid, just renewal request failed - allow retry
          console.warn(`⚠️ [ActivityTracker] Renewal attempt #${renewalAttempts.current} failed but session still valid (${Math.floor(timeUntilExpiry / 60000)} min remaining), will retry`);
          
          // Only show warning if we've failed multiple times
          if (renewalAttempts.current >= 3) {
            toast.warning('Session renewal experiencing issues. Your session may expire soon.', {
              duration: 6000,
              icon: '⚠️'
            });
          }
        }
      }
    } finally {
      // Add grace period before clearing flags to prevent race conditions
      setTimeout(() => {
        renewalInProgress.current = false;
        globalRenewalInProgress = false;
       // console.log('🏁 [ActivityTracker] Renewal process complete, flags cleared');
      }, 1000); // 1 second grace period
    }
  }, []);

  const checkAndRenewSessionRef = useRef(checkAndRenewSession);
  checkAndRenewSessionRef.current = checkAndRenewSession;

  // Check on mount and interval
  useEffect(() => {
    const initialTimeout = setTimeout(() => {
      void checkAndRenewSessionRef.current();
    }, 2000);

    const intervalId = setInterval(() => {
      void checkAndRenewSessionRef.current();
    }, RENEWAL_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
  }, []);

  // Check on tab focus (user returns to tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => {
          void checkAndRenewSessionRef.current();
        }, 500);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
};

export default ActivityTracker;

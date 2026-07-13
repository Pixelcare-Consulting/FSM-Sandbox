/**
 * Detects user inactivity and triggers logout after the configured idle period.
 * Only runs for authenticated users on non-auth pages.
 * Activity is synced across tabs via localStorage.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Cookies from 'js-cookie';
import { toast } from 'react-toastify';
import SESSION_CONFIG from '../config/session.config';
import {
  getSharedLastActivityAt,
  setSharedLastActivityAt,
  subscribeToSharedActivity,
  coordinatedSessionLogout,
  isLogoutInProgress,
  resetSharedActivityOnLogin,
  syncActivityWithLoginSession,
  isWithinPostLoginGrace,
} from '../lib/auth/sessionTabSync';

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
];

const ACTIVITY_THROTTLE_MS = 1000;
const DEFAULT_WARNING_MS = 2 * 60 * 1000;

function isAuthRoute(pathname) {
  return pathname.includes('/authentication') || pathname === '/sign-in';
}

function isUserAuthenticated() {
  return Boolean(Cookies.get('uid'));
}

export function useIdleTimeout(options = {}) {
  const {
    timeoutMs = SESSION_CONFIG.IDLE_TIMEOUT_MS,
    warningMs = DEFAULT_WARNING_MS,
    enabled = true,
    onIdle,
  } = options;

  const router = useRouter();
  const lastActivityRef = useRef(getSharedLastActivityAt());
  const lastThrottleRef = useRef(0);
  const idleTimerRef = useRef(null);
  const warningTimerRef = useRef(null);
  const warningShownRef = useRef(false);
  const isLoggingOutRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
  }, []);

  const resolveLastActivity = useCallback(() => {
    if (isWithinPostLoginGrace(Cookies.get)) {
      const baseline = resetSharedActivityOnLogin(Cookies.get);
      lastActivityRef.current = baseline;
      return baseline;
    }

    const synced = syncActivityWithLoginSession(Cookies.get);
    const lastActivity = Math.max(lastActivityRef.current, synced);
    lastActivityRef.current = lastActivity;
    return lastActivity;
  }, []);

  const performLogout = useCallback(async () => {
    if (isLoggingOutRef.current || isLogoutInProgress()) return;
    if (isWithinPostLoginGrace(Cookies.get)) return;

    const lastActivity = resolveLastActivity();
    const elapsed = Date.now() - lastActivity;
    if (elapsed < timeoutMs) {
      lastActivityRef.current = lastActivity;
      return;
    }

    isLoggingOutRef.current = true;
    clearTimers();

    const message = `You were signed out due to ${SESSION_CONFIG.IDLE_TIMEOUT_MINUTES} minutes of inactivity.`;

    await coordinatedSessionLogout({
      message,
      reason: 'idle_timeout',
      redirect: onIdle
        ? (msg) => onIdle(msg)
        : (msg) => {
            window.location.replace(
              '/sign-in?toast=' + encodeURIComponent(msg)
            );
          },
    });
  }, [clearTimers, onIdle, resolveLastActivity, timeoutMs]);

  const scheduleTimers = useCallback(() => {
    clearTimers();

    if (!enabled || !isUserAuthenticated() || isAuthRoute(router.pathname)) {
      return;
    }

    const lastActivity = resolveLastActivity();

    const elapsed = Date.now() - lastActivity;
    const remaining = timeoutMs - elapsed;

    if (remaining <= 0) {
      performLogout();
      return;
    }

    const warningAt = remaining - warningMs;
    if (warningAt > 0) {
      warningTimerRef.current = setTimeout(() => {
        if (!isUserAuthenticated() || isAuthRoute(router.pathname)) return;
        if (warningShownRef.current) return;

        warningShownRef.current = true;
        toast.warning('You will be signed out in 2 minutes due to inactivity.', {
          toastId: 'idle-timeout-warning',
          autoClose: 10000,
          position: 'top-right',
        });
      }, warningAt);
    }

    idleTimerRef.current = setTimeout(performLogout, remaining);
  }, [clearTimers, enabled, performLogout, resolveLastActivity, router.pathname, timeoutMs, warningMs]);

  const resetActivity = useCallback(() => {
    if (!enabled || !isUserAuthenticated() || isAuthRoute(router.pathname)) {
      return;
    }

    const now = Date.now();
    lastActivityRef.current = now;
    setSharedLastActivityAt(now);
    warningShownRef.current = false;
    scheduleTimers();
  }, [enabled, router.pathname, scheduleTimers]);

  useEffect(() => {
    if (!enabled) return;

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastThrottleRef.current < ACTIVITY_THROTTLE_MS) return;
      lastThrottleRef.current = now;
      resetActivity();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (isWithinPostLoginGrace(Cookies.get)) {
        resolveLastActivity();
        scheduleTimers();
        return;
      }

      const lastActivity = resolveLastActivity();
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= timeoutMs) {
        performLogout();
        return;
      }

      scheduleTimers();
    };

    const cleanupActivityListener = subscribeToSharedActivity((timestamp) => {
      if (timestamp > lastActivityRef.current) {
        lastActivityRef.current = timestamp;
        warningShownRef.current = false;
        scheduleTimers();
      }
    });

    if (isUserAuthenticated() && !isAuthRoute(router.pathname)) {
      resolveLastActivity();
      scheduleTimers();
    }

    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cleanupActivityListener();
      clearTimers();
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    clearTimers,
    enabled,
    performLogout,
    resetActivity,
    router.pathname,
    resolveLastActivity,
    scheduleTimers,
    timeoutMs,
  ]);

  return { resetActivity };
}

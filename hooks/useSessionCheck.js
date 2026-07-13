/**
 * Validates session on dashboard mount and polls every 60s (leader tab only).
 * Redirects to sign-in only after confirmed session invalidation (not transient 401s).
 */
import { useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Cookies from 'js-cookie';
import {
  shouldLogoutOnAuthError,
  coordinatedSessionLogout,
  subscribeToSessionLogout,
  subscribeToSessionPoll,
  isLogoutInProgress,
  isWithinPostLoginGrace,
  tryAcquireSessionProbe,
  tryBecomeSessionPollLeader,
  refreshSessionPollLeaderHeartbeat,
  releaseSessionPollLeader,
  broadcastSessionPollOk,
  broadcastSessionPollExpired,
} from '../lib/auth/sessionTabSync';

const POLL_INTERVAL_MS = 60 * 1000;

function fetchUserInfo() {
  return fetch('/api/getUserInfo', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
  });
}

function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function useSessionCheck() {
  const router = useRouter();
  const redirecting = useRef(false);
  const pathnameRef = useRef(router.pathname);
  pathnameRef.current = router.pathname;

  const redirectToSignIn = useCallback(
    (message) => {
      if (redirecting.current) return;
      redirecting.current = true;
      router.replace(
        '/sign-in?toast=' + encodeURIComponent(message || 'Session expired. Please log in again.')
      );
    },
    [router.replace]
  );

  const redirectToSignInRef = useRef(redirectToSignIn);
  redirectToSignInRef.current = redirectToSignIn;

  const handleAuthFailure = useCallback(async (errData) => {
    if (redirecting.current || isLogoutInProgress()) return;
    if (isWithinPostLoginGrace(Cookies.get)) return;

    const decision = await shouldLogoutOnAuthError(
      errData,
      Cookies.get,
      fetchUserInfo
    );

    if (!decision.logout) return;

    broadcastSessionPollExpired(errData);

    await coordinatedSessionLogout({
      message: decision.message,
      reason: errData?.code || 'session_check',
      redirect: (msg) => redirectToSignInRef.current(msg),
    });
  }, []);

  const handleAuthFailureRef = useRef(handleAuthFailure);
  handleAuthFailureRef.current = handleAuthFailure;

  const checkSession = useCallback(async () => {
    if (redirecting.current || isLogoutInProgress()) return;
    if (!pathnameRef.current.includes('/dashboard')) return;
    if (isWithinPostLoginGrace(Cookies.get)) return;
    if (!isDocumentVisible()) return;
    if (!tryBecomeSessionPollLeader()) return;
    if (!tryAcquireSessionProbe()) return;

    try {
      const res = await fetchUserInfo();
      if (res.ok) {
        refreshSessionPollLeaderHeartbeat();
        broadcastSessionPollOk();
        return;
      }
      if (res.status === 401) {
        const errData = await res.json().catch(() => ({}));
        await handleAuthFailureRef.current(errData);
      }
    } catch {
      // network blip — do not logout
    }
  }, []);

  const checkSessionRef = useRef(checkSession);
  checkSessionRef.current = checkSession;

  useEffect(() => {
    const unsubscribe = subscribeToSessionLogout((message) => {
      redirectToSignInRef.current(message);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribePoll = subscribeToSessionPoll({
      onExpired: (errData) => {
        void handleAuthFailureRef.current(errData);
      },
    });
    return unsubscribePoll;
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isDocumentVisible()) {
        releaseSessionPollLeader();
        return;
      }
      tryBecomeSessionPollLeader();
      void checkSessionRef.current();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseSessionPollLeader();
    };
  }, []);

  useEffect(() => {
    void checkSessionRef.current();
    const interval = setInterval(() => {
      void checkSessionRef.current();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}

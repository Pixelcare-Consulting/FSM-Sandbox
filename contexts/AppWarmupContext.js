import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAppWarmup } from '../hooks/useAppWarmup';
import {
  isWarmupDone,
  markWarmupDone,
} from '../lib/session/appWarmup';
import {
  broadcastWarmupDone,
  releaseWarmupLock,
  subscribeToWarmupDone,
  tryAcquireWarmupLock,
} from '../lib/auth/sessionTabSync';

const AppWarmupContext = createContext(null);

export function AppWarmupProvider({ children }) {
  const router = useRouter();
  const warmup = useAppWarmup();
  const attemptedRef = useRef(false);

  const isDashboardRoute =
    router.pathname.includes('dashboard') ||
    router.pathname.startsWith('/customers/view');

  useEffect(() => {
    if (!router.isReady || !isDashboardRoute) return;
    if (attemptedRef.current || isWarmupDone() || warmup.isWarming) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    const unsubscribe = subscribeToWarmupDone((at) => {
      markWarmupDone(at);
      attemptedRef.current = true;
    });

    if (isWarmupDone()) {
      attemptedRef.current = true;
      return unsubscribe;
    }

    if (!tryAcquireWarmupLock()) {
      return unsubscribe;
    }

    attemptedRef.current = true;
    void warmup
      .runWarmup()
      .then(() => {
        const at = Date.now();
        markWarmupDone(at);
        broadcastWarmupDone(at);
      })
      .finally(() => {
        releaseWarmupLock();
      });

    return unsubscribe;
  }, [router.isReady, isDashboardRoute, warmup]);

  const value = useMemo(
    () => ({
      isWarming: warmup.isWarming,
      progress: warmup.progress,
      label: warmup.label,
      runWarmup: warmup.runWarmup,
    }),
    [warmup]
  );

  return (
    <AppWarmupContext.Provider value={value}>{children}</AppWarmupContext.Provider>
  );
}

export function useAppWarmupContext() {
  const context = useContext(AppWarmupContext);
  if (!context) {
    return {
      isWarming: false,
      progress: 0,
      label: '',
      runWarmup: async () => {},
    };
  }
  return context;
}

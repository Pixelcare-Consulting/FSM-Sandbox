import { useCallback, useState } from 'react';
import { useQueryClient } from 'react-query';
import { isWarmupDone, runAppWarmup } from '../lib/session/appWarmup';

const INITIAL_STATE = {
  isWarming: false,
  progress: 0,
  label: '',
};

/**
 * Warmup state + runner. Used by AppWarmupProvider and sign-in flow.
 */
export function useAppWarmup() {
  const queryClient = useQueryClient();
  const [state, setState] = useState(INITIAL_STATE);

  const runWarmup = useCallback(
    async ({ force = false } = {}) => {
      if (!force && isWarmupDone()) {
        setState((prev) => ({ ...prev, isWarming: false, progress: 100 }));
        return;
      }

      setState({
        isWarming: true,
        progress: 0,
        label: 'Preparing your workspace…',
      });

      try {
        await runAppWarmup({
          queryClient,
          onProgress: ({ percent, label }) => {
            setState((prev) => ({
              ...prev,
              progress: percent,
              label: label || prev.label,
            }));
          },
        });
        setState((prev) => ({
          ...prev,
          isWarming: false,
          progress: 100,
        }));
      } catch (error) {
        console.warn('[useAppWarmup] warmup failed:', error);
        setState((prev) => ({
          ...prev,
          isWarming: false,
          progress: 100,
        }));
      }
    },
    [queryClient]
  );

  return {
    ...state,
    runWarmup,
  };
}

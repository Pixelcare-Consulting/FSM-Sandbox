import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';

const STALE_TIME_MS = 60_000;

export async function fetchGoogleFormsList() {
  const response = await fetch('/api/google-forms/list', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || 'Failed to fetch Google Forms');
  }
  const data = await response.json();
  return data.forms || [];
}

export function useGoogleFormsListQuery({ enabled = true } = {}) {
  const query = useQuery(queryKeys.googleFormsList(), fetchGoogleFormsList, {
    enabled,
    staleTime: STALE_TIME_MS,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  return {
    ...query,
    forms: query.data ?? [],
  };
}

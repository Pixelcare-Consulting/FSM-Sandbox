import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchWithTimeout } from '../../lib/utils/fetchWithTimeout';

const BUNDLE_TIMEOUT_MS = 45_000;
const DETAIL_STALE_MS = 3 * 60 * 1000;

export const LEAD_DETAIL_QUERY_OPTIONS = {
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};

export async function fetchLeadDetail(leadCode) {
  if (!leadCode) {
    throw new Error('leadCode is required');
  }

  const bundleRes = await fetchWithTimeout(
    `/api/leads/masterlist-bundle/${encodeURIComponent(leadCode)}`,
    { credentials: 'same-origin' },
    BUNDLE_TIMEOUT_MS,
  );

  if (!bundleRes.ok) {
    throw new Error(`Failed to load lead bundle (${bundleRes.status})`);
  }

  const bundleJson = await bundleRes.json();
  if (!bundleJson?.success) {
    throw new Error(bundleJson?.error || 'Failed to load lead bundle');
  }

  return {
    partner: bundleJson.partner || null,
    addressDetails: bundleJson.addressDetails || { data: {}, dataByCustomerLocationId: {} },
  };
}

export function useLeadDetailQuery(leadCode, { enabled = true } = {}) {
  return useQuery(queryKeys.leadDetail(leadCode), () => fetchLeadDetail(leadCode), {
    enabled: Boolean(enabled && leadCode),
    staleTime: DETAIL_STALE_MS,
    cacheTime: 10 * 60 * 1000,
    ...LEAD_DETAIL_QUERY_OPTIONS,
  });
}

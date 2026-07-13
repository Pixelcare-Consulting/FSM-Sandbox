import { useCallback } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchWithTimeout } from '../../lib/utils/fetchWithTimeout';

const BUNDLE_TIMEOUT_MS = 45_000;
const SAP_CUSTOMER_TIMEOUT_MS = 35_000;
const DETAIL_STALE_MS = 3 * 60 * 1000;

export const CUSTOMER_DETAIL_QUERY_OPTIONS = {
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
};

export async function fetchCustomerDetail(cardCode, { forceRefresh = false } = {}) {
  if (!cardCode) {
    throw new Error('cardCode is required');
  }

  let bundleOutcome = {
    partner: null,
    fromMasterlist: false,
    addressDetails: null,
    customerUuid: null,
  };

  try {
    const bundleUrl =
      `/api/customers/masterlist-bundle/${encodeURIComponent(cardCode)}` +
      (forceRefresh ? '?refresh=1' : '');
    const bundleRes = await fetchWithTimeout(
      bundleUrl,
      { credentials: 'same-origin' },
      BUNDLE_TIMEOUT_MS,
    );
    if (bundleRes.ok) {
      const bundleJson = await bundleRes.json();
      if (bundleJson?.success) {
        bundleOutcome = {
          partner: bundleJson.partner || null,
          fromMasterlist: Boolean(bundleJson.partner),
          addressDetails: bundleJson.addressDetails || { data: {}, dataByCustomerLocationId: {} },
          customerUuid: bundleJson.customerUuid || null,
        };
      }
    }
  } catch (bundleErr) {
    console.warn('masterlist-bundle fetch failed:', bundleErr);
  }

  let customerInfo = bundleOutcome.partner;
  let addressDetails = bundleOutcome.addressDetails;
  const customerUuid = bundleOutcome.customerUuid;
  const fromMasterlist = bundleOutcome.fromMasterlist;

  if (!customerInfo) {
    const customerResponse = await fetchWithTimeout(
      `/api/getCustomerCode?cardCode=${encodeURIComponent(cardCode)}`,
      {},
      SAP_CUSTOMER_TIMEOUT_MS,
    );
    if (!customerResponse.ok) {
      throw new Error(`Failed to fetch customer details: ${await customerResponse.text()}`);
    }
    customerInfo = await customerResponse.json();
    addressDetails = null;
  }

  return {
    partner: customerInfo,
    addressDetails,
    customerUuid,
    fromMasterlist,
  };
}

export function useCustomerDetailQuery(cardCode, { enabled = true } = {}) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.customerDetail(cardCode);

  const query = useQuery(queryKey, () => fetchCustomerDetail(cardCode), {
    enabled: Boolean(enabled && cardCode),
    staleTime: DETAIL_STALE_MS,
    cacheTime: 10 * 60 * 1000,
    ...CUSTOMER_DETAIL_QUERY_OPTIONS,
  });

  const refetchFresh = useCallback(async () => {
    const fresh = await fetchCustomerDetail(cardCode, { forceRefresh: true });
    queryClient.setQueryData(queryKey, fresh);
    return fresh;
  }, [queryClient, queryKey, cardCode]);

  return {
    ...query,
    refetchFresh,
  };
}

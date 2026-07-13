import { useQuery } from 'react-query';
import { queryKeys } from '../../lib/cache/queryKeys';
import { fetchCustomerAddressDetails } from '../../lib/customers/fetchCustomerAddressDetails';
import {
  JOB_SATELLITE_CACHE_MS,
  JOB_SATELLITE_QUERY_OPTIONS,
  JOB_SATELLITE_STALE_MS,
} from '../../lib/jobs/jobSatelliteQueryOptions';

export { fetchCustomerAddressDetails };

export function useCustomerAddressQuery(customerCode, { enabled = true } = {}) {
  return useQuery(
    queryKeys.customerAddressDetails(customerCode),
    () => fetchCustomerAddressDetails(customerCode),
    {
      enabled: Boolean(enabled && customerCode),
      staleTime: JOB_SATELLITE_STALE_MS,
      cacheTime: JOB_SATELLITE_CACHE_MS,
      ...JOB_SATELLITE_QUERY_OPTIONS,
    }
  );
}

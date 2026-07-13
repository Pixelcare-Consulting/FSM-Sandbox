import { useQuery } from 'react-query';
import {
  DASHBOARD_BOOTSTRAP_QUERY_KEY,
  fetchDashboardBootstrapFromApi,
} from '../utils/dashboardBootstrapCache';

export { DASHBOARD_BOOTSTRAP_QUERY_KEY };

export function useDashboardBootstrap(options = {}) {
  return useQuery(
    DASHBOARD_BOOTSTRAP_QUERY_KEY,
    () => fetchDashboardBootstrapFromApi(),
    {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      ...options,
    }
  );
}

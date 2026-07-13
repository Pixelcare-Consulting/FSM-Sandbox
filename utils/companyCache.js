import { getSupabaseClient } from '../lib/supabase/client';
import { readCachedDashboardBootstrap } from './dashboardBootstrapCache';
import { readCachedSettingsBundle } from './settingsBundleCache';

const COMPANY_CACHE_KEY = 'companyDetails';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export const getCompanyDetails = async () => {
  try {
    const bootstrapCached = readCachedDashboardBootstrap();
    if (bootstrapCached?.companyInfo) {
      return bootstrapCached.companyInfo;
    }

    const bundleCached = readCachedSettingsBundle();
    if (bundleCached?.companyInfo) {
      return bundleCached.companyInfo;
    }

    // Check localStorage first
    const cachedData = localStorage.getItem(COMPANY_CACHE_KEY);
    if (cachedData) {
      const { data, timestamp } = JSON.parse(cachedData);
      
      // Check if cache is still valid
      if (Date.now() - timestamp < CACHE_DURATION) {
        return data;
      }
    }

    // If no valid cache, fetch from Supabase
    const supabase = getSupabaseClient();
    if (!supabase) {
      return null;
    }

    const { data: companyData, error } = await supabase
      .from('company_details')
      .select('*')
      .eq('id', 'companyInfo')
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (companyData) {
      // Cache the result
      localStorage.setItem(COMPANY_CACHE_KEY, JSON.stringify({
        data: companyData,
        timestamp: Date.now()
      }));
      
      return companyData;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching company details:', error);
    return null;
  }
}; 
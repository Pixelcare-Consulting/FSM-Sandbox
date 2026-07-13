import { fetchSettingsBundle } from '../settings/settingsBundle';
import { companyMemoService } from '../supabase/database';

/**
 * Load dashboard boot data in one server round-trip (user already validated by requireSession).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} sessionUser
 */
export async function fetchDashboardBootstrap(supabase, sessionUser) {
  const [settingsBundle, signInMemos] = await Promise.all([
    fetchSettingsBundle(supabase),
    companyMemoService.listForSignIn(supabase),
  ]);

  return {
    user: sessionUser,
    companyInfo: settingsBundle.companyInfo,
    signInMemos,
    jobStatuses: settingsBundle.jobStatuses,
    fetchedAt: new Date().toISOString(),
  };
}

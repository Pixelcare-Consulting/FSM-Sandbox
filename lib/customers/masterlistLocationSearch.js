import {
  applyMultiTokenIlikeFilters,
  parseSearchTokens,
} from '../supabase/listQueryHelpers.js';

/** Site text columns searched for masterlist global / list filters. */
export const CUSTOMER_LOCATION_SEARCH_FIELDS = [
  'site_id',
  'building',
  'street',
  'street_number',
  'block',
  'address',
  'city',
  'zip_code',
  'country_name',
];

export const SAP_LEAD_LOCATION_SEARCH_FIELDS = CUSTOMER_LOCATION_SEARCH_FIELDS;

const DEFAULT_ID_LIMIT = 200;

/**
 * Customer IDs whose customer_location site text matches all search tokens.
 * Caps result IDs (egress-safe); does not load full masterlists.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|string[]} queryOrTokens
 * @param {number} [limit]
 * @returns {Promise<string[]>}
 */
export async function findCustomerIdsMatchingLocationTokens(
  supabase,
  queryOrTokens,
  limit = DEFAULT_ID_LIMIT
) {
  const tokens =
    typeof queryOrTokens === 'string'
      ? parseSearchTokens(queryOrTokens)
      : queryOrTokens || [];
  if (tokens.length === 0) return [];

  let query = supabase
    .from('customer_location')
    .select('customer_id')
    .limit(Math.min(Math.max(1, Number(limit) || DEFAULT_ID_LIMIT), 200));

  query = applyMultiTokenIlikeFilters(query, tokens, CUSTOMER_LOCATION_SEARCH_FIELDS);

  const { data, error } = await query;
  if (error) throw error;

  return [
    ...new Set((data || []).map((row) => row.customer_id).filter(Boolean)),
  ];
}

/**
 * sap_lead IDs whose sap_lead_location site text matches all search tokens.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|string[]} queryOrTokens
 * @param {number} [limit]
 * @returns {Promise<string[]>}
 */
export async function findSapLeadIdsMatchingLocationTokens(
  supabase,
  queryOrTokens,
  limit = DEFAULT_ID_LIMIT
) {
  const tokens =
    typeof queryOrTokens === 'string'
      ? parseSearchTokens(queryOrTokens)
      : queryOrTokens || [];
  if (tokens.length === 0) return [];

  let query = supabase
    .from('sap_lead_location')
    .select('sap_lead_id')
    .limit(Math.min(Math.max(1, Number(limit) || DEFAULT_ID_LIMIT), 200));

  query = applyMultiTokenIlikeFilters(query, tokens, SAP_LEAD_LOCATION_SEARCH_FIELDS);

  const { data, error } = await query;
  if (error) throw error;

  return [
    ...new Set((data || []).map((row) => row.sap_lead_id).filter(Boolean)),
  ];
}

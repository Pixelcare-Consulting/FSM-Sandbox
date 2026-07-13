import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { fetchAddressDetailsMaps } from '../../../../lib/customers/addressDetailsMaps';
import {
  sapPartnerFromSupabaseCustomerBundle,
  SUPABASE_CUSTOMER_WITH_LOCATIONS_SELECT,
} from '../../../../lib/customers/supabaseCustomerSapShim';
import customerCache from '../../../../lib/utils/customerCache';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const raw = req.query.customerCode;
  const customerCode = raw != null ? String(raw).trim() : '';
  if (!customerCode) {
    return res.status(400).json({ success: false, error: 'customerCode is required' });
  }

  const skipCache = String(req.query.refresh || req.query.nocache || '') === '1';

  if (!skipCache) {
    const cachedBundle = customerCache.getCachedCustomerBundle(customerCode);
    if (cachedBundle) {
      return res.status(200).json({ ...cachedBundle, cached: true });
    }
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return res.status(503).json({ success: false, error: 'Database unavailable' });
  }

  try {
    const [customerResult, addressDetails] = await Promise.all([
      supabase
        .from('customer')
        .select(SUPABASE_CUSTOMER_WITH_LOCATIONS_SELECT)
        // Case-insensitive CardCode match (PostgREST ilike without wildcards).
        .ilike('customer_code', customerCode)
        .is('deleted_at', null)
        .maybeSingle(),
      fetchAddressDetailsMaps(supabase, customerCode),
    ]);

    const { data: row, error: sbErr } = customerResult;

    if (sbErr) {
      console.error('masterlist-bundle select:', sbErr);
      return res.status(500).json({ success: false, error: sbErr.message });
    }

    if (!row) {
      const emptyPayload = {
        success: true,
        partner: null,
        customerUuid: null,
        sapCardCode: null,
        addressDetails,
      };
      customerCache.cacheCustomerBundle(customerCode, emptyPayload);
      return res.status(200).json(emptyPayload);
    }

    const payload = {
      success: true,
      partner: sapPartnerFromSupabaseCustomerBundle(row),
      customerUuid: row.id || null,
      sapCardCode: row.sap_card_code || null,
      addressDetails,
    };
    customerCache.cacheCustomerBundle(customerCode, payload);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('masterlist-bundle:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  }
}

/**
 * GET — SAP-style customers from Supabase public.customer (imported / legacy master list).
 * Same shape as /api/getCustomers (array of { cardCode, cardName, ... }) for drop-in UI use.
 * Does not require SAP B1 session cookies.
 */

import { customerService } from '../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import {
  getListCache,
  logResponseSize,
  setListCache,
} from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Accept');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=300');

  const cacheKey = 'customers-sap-masterlist';
  const skipCache =
    req.query.refresh === '1' ||
    req.query.refresh === 'true' ||
    req.query.refresh === 'yes';
  if (!skipCache) {
    const cached = getListCache(cacheKey, CACHE_TTL_MS);
    if (cached) {
      logResponseSize('customers/sap-masterlist (cached)', cached);
      return res.status(200).json(cached);
    }
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const [customerRows, leadRows] = await Promise.all([
      customerService.getSapMasterlistCustomers(supabase),
      customerService.getSapMasterlistLeads(supabase),
    ]);

    const byCode = new Map();

    for (const r of customerRows || []) {
      const cardCode = String(r?.customer_code || '').trim();
      if (!cardCode) continue;
      byCode.set(cardCode, {
        cardCode,
        cardName: r.customer_name != null ? String(r.customer_name).trim() : '',
        customerId: r.id,
        email: r.email || '',
        phone_number: r.phone_number || '',
        customer_address: r.customer_address || '',
        sap_card_code: r.sap_card_code || null,
      });
    }

    for (const r of leadRows || []) {
      const cardCode = String(r?.lead_code || '').trim();
      if (!cardCode || byCode.has(cardCode)) continue;
      byCode.set(cardCode, {
        cardCode,
        cardName: r.lead_name != null ? String(r.lead_name).trim() : '',
        customerId: null,
        isSapLead: true,
        email: r.email || '',
        phone_number: r.phone_number || '',
        customer_address: r.lead_address || '',
      });
    }

    const out = [...byCode.values()].sort((a, b) =>
      a.cardCode.localeCompare(b.cardCode, undefined, { numeric: true, sensitivity: 'base' })
    );

    setListCache(cacheKey, out, CACHE_TTL_MS);
    logResponseSize('customers/sap-masterlist', out);

    return res.status(200).json(out);
  } catch (err) {
    console.error('sap-masterlist GET error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load SAP master list customers' });
  }
}

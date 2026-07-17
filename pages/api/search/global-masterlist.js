/**
 * GET /api/search/global-masterlist?q=...&quick=1
 *
 * Server-filtered masterlist search (customers, sap_lead, form leads).
 * Caps: 50 (quick) / 200 (full). Short private cache.
 */
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { withSession } from '../../../lib/api/withSession';
import { textMatchesAllSearchTokens } from '../../../lib/utils/multiTokenSearch';
import {
  SUPABASE_CUSTOMER_LIST_FLAT_SELECT,
  listRowFromSupabaseCustomer,
} from '../../../lib/customers/supabaseCustomerSapShim';
import { mergeSapAddressFieldsDeduped } from '../../../lib/customers/mergeSapAddressSegments';
import {
  SUPABASE_SAP_LEAD_LIST_SUMMARY_SELECT,
  listRowFromSupabaseSapLead,
} from '../../../lib/leads/supabaseLeadSapShim';
import {
  applyMultiTokenIlikeFilters,
  getListCache,
  logResponseSize,
  parseSearchTokens,
  setListCache,
} from '../../../lib/supabase/listQueryHelpers';
import {
  findCustomerIdsMatchingLocationTokens,
  findSapLeadIdsMatchingLocationTokens,
} from '../../../lib/customers/masterlistLocationSearch';

const QUICK_LIMIT = 50;
const FULL_LIMIT = 200;
const MAX_FORM_LEADS = 200;
const CACHE_TTL_MS = 30000;
const LOCATION_MATCH_ID_LIMIT = 200;

const CUSTOMER_SEARCH_FIELDS = [
  'customer_code',
  'customer_name',
  'phone_number',
  'email',
  'customer_address',
];

const SAP_LEAD_SEARCH_FIELDS = [
  'lead_code',
  'lead_name',
  'phone_number',
  'email',
  'lead_address',
];

const FORM_LEAD_SEARCH_FIELDS = [
  'full_name',
  'email',
  'handphone',
  'address',
  'block',
  'unit',
  'building',
  'street',
  'postcode',
];

function formatCustomerResultAddress(c) {
  if (c.AllAddresses && c.AllAddresses.length > 0) {
    const a = c.AllAddresses[0];
    const core = mergeSapAddressFieldsDeduped([
      a.Address1,
      a.Address2,
      a.Address3,
      a.Street,
      a.Building,
      a.BuildingFloorRoom,
      a.City,
    ]);
    const zipPostal = String(a.PostalCode ?? '').trim();
    const zipCode = String(a.ZipCode ?? '').trim();
    const zips =
      zipPostal && zipCode && zipPostal === zipCode
        ? [zipPostal]
        : [zipPostal, zipCode].filter(Boolean);
    const country = String(a.CountryName || a.Country || '').trim();
    const line = [core || null, ...zips, country || null].filter(Boolean).join(', ');
    if (line) {
      if (c.AllAddresses.length > 1) {
        return `${line} · (+${c.AllAddresses.length - 1} more addresses)`;
      }
      return line;
    }
  }
  return 'No address';
}

function mapMasterlistCustomerToResult(c) {
  const tel = c.Cellular || c.Phone1;
  return {
    id: `ml-cust-${c.CardCode}`,
    type: 'customer',
    customerKind: 'masterlist',
    title: c.CardName || 'Unnamed customer',
    subtitle: `Customer · ${c.CardCode || 'N/A'} · ${tel || 'No phone'}`,
    address: formatCustomerResultAddress(c),
    link: `/customers/view/${encodeURIComponent(c.CardCode)}`,
    rawTitle: c.CardName,
    email: c.EmailAddress,
    tel,
    bpCode: c.CardCode,
  };
}

function mapMasterlistLeadToResult(lead) {
  const tel = lead.Cellular || lead.Phone1;
  const addrParts = [
    lead.Street,
    lead.Building || lead.BillToBuildingFloorRoom,
    lead.City,
    lead.Country === 'SG' ? 'Singapore' : lead.Country,
    lead.ZipCode,
  ].filter((part) => part && String(part).trim());
  const addr =
    (addrParts.length > 0 ? addrParts.join(', ') : null) ||
    lead.Address ||
    'No address';

  return {
    id: `ml-lead-${lead.CardCode}`,
    type: 'lead',
    customerKind: 'masterlistLead',
    title: lead.CardName || 'Unnamed lead',
    subtitle: `SAP lead (masterlist) · ${lead.CardCode || 'N/A'} · ${tel || 'No phone'}`,
    address: addr,
    link: `/leads/view/${encodeURIComponent(lead.CardCode)}`,
    rawTitle: lead.CardName,
    email: lead.EmailAddress,
    tel,
    bpCode: lead.CardCode,
  };
}

function leadRowBlob(l) {
  return [l.full_name, l.email, l.handphone, l.address, l.block, l.unit, l.building, l.street, l.postcode]
    .filter((f) => f != null && String(f).trim() !== '')
    .map((f) => String(f).toLowerCase())
    .join(' ');
}

function mapFormLeadRow(l) {
  const addressLine =
    [l.address, l.block, l.unit, l.building, l.street, l.postcode].filter(Boolean).join(', ') ||
    'No address';
  const title = l.full_name || l.email || 'Lead';
  return {
    id: `db-lead-${l.id}`,
    type: 'customer',
    customerKind: 'formLead',
    title,
    subtitle: `Form lead · ${l.handphone || l.email || 'No contact'}`,
    address: addressLine,
    link: '/customer-leads',
    rawTitle: title,
    email: l.email,
    tel: l.handphone,
    bpCode: null,
  };
}

function mergeMasterlistSearchResults(formLeadRows, customerResults, sapLeadResults) {
  const results = [];
  const seenCode = new Set();

  for (const row of customerResults) {
    if (row && row.bpCode) {
      seenCode.add(String(row.bpCode).toUpperCase());
    }
    results.push(row);
  }

  for (const row of sapLeadResults) {
    const code = (row.bpCode && String(row.bpCode).toUpperCase()) || '';
    if (!code || seenCode.has(code)) continue;
    seenCode.add(code);
    results.push(row);
  }

  for (const r of formLeadRows) {
    if (r.customerKind === 'formLead' || r.bpCode == null || r.bpCode === '') {
      results.push(r);
      continue;
    }
    const code = String(r.bpCode).toUpperCase();
    if (seenCode.has(code)) continue;
    results.push(r);
  }

  results.sort((a, b) =>
    (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
  );
  return results;
}

async function searchCustomersFiltered(supabase, tokens, limit) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || QUICK_LIMIT), FULL_LIMIT);

  let flatQuery = supabase
    .from('customer')
    .select(SUPABASE_CUSTOMER_LIST_FLAT_SELECT)
    .is('deleted_at', null)
    .order('customer_name', { ascending: true })
    .limit(safeLimit);

  if (tokens.length > 0) {
    flatQuery = applyMultiTokenIlikeFilters(flatQuery, tokens, CUSTOMER_SEARCH_FIELDS);
  }

  const locationIdsPromise =
    tokens.length > 0
      ? findCustomerIdsMatchingLocationTokens(supabase, tokens, LOCATION_MATCH_ID_LIMIT)
      : Promise.resolve([]);

  const [{ data: flatRows, error: flatError }, locationCustomerIds] = await Promise.all([
    flatQuery,
    locationIdsPromise,
  ]);
  if (flatError) throw flatError;

  const byId = new Map();
  for (const row of flatRows || []) {
    if (row?.id) byId.set(row.id, row);
  }

  const missingIds = locationCustomerIds.filter((id) => id && !byId.has(id));
  if (missingIds.length > 0) {
    const { data: locationRows, error: locationError } = await supabase
      .from('customer')
      .select(SUPABASE_CUSTOMER_LIST_FLAT_SELECT)
      .is('deleted_at', null)
      .in('id', missingIds.slice(0, safeLimit))
      .order('customer_name', { ascending: true });
    if (locationError) throw locationError;
    for (const row of locationRows || []) {
      if (row?.id) byId.set(row.id, row);
    }
  }

  return [...byId.values()]
    .sort((a, b) =>
      String(a.customer_name || '').localeCompare(String(b.customer_name || ''), undefined, {
        sensitivity: 'base',
      })
    )
    .slice(0, safeLimit);
}

async function searchSapLeadsFiltered(supabase, tokens, limit) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || QUICK_LIMIT), FULL_LIMIT);
  const leadSelect = `id, ${SUPABASE_SAP_LEAD_LIST_SUMMARY_SELECT.trim()}`;

  let flatQuery = supabase
    .from('sap_lead')
    .select(leadSelect)
    .is('deleted_at', null)
    .order('lead_name', { ascending: true })
    .limit(safeLimit);

  if (tokens.length > 0) {
    flatQuery = applyMultiTokenIlikeFilters(flatQuery, tokens, SAP_LEAD_SEARCH_FIELDS);
  }

  const locationIdsPromise =
    tokens.length > 0
      ? findSapLeadIdsMatchingLocationTokens(supabase, tokens, LOCATION_MATCH_ID_LIMIT)
      : Promise.resolve([]);

  const [{ data: flatRows, error: flatError }, locationLeadIds] = await Promise.all([
    flatQuery,
    locationIdsPromise,
  ]);
  if (flatError) throw flatError;

  const byId = new Map();
  for (const row of flatRows || []) {
    if (row?.id) byId.set(row.id, row);
  }

  const missingIds = locationLeadIds.filter((id) => id && !byId.has(id));
  if (missingIds.length > 0) {
    const { data: locationRows, error: locationError } = await supabase
      .from('sap_lead')
      .select(leadSelect)
      .is('deleted_at', null)
      .in('id', missingIds.slice(0, safeLimit))
      .order('lead_name', { ascending: true });
    if (locationError) throw locationError;
    for (const row of locationRows || []) {
      if (row?.id) byId.set(row.id, row);
    }
  }

  return [...byId.values()]
    .sort((a, b) =>
      String(a.lead_name || '').localeCompare(String(b.lead_name || ''), undefined, {
        sensitivity: 'base',
      })
    )
    .slice(0, safeLimit);
}

async function searchFormLeadsFiltered(supabase, tokens, limit) {
  let query = supabase
    .from('leads')
    .select(
      'id, full_name, email, handphone, address, block, unit, status, customer_id, source, building, street, postcode'
    )
    .is('deleted_at', null)
    .is('customer_id', null)
    .order('submitted_at', { ascending: false })
    .limit(Math.min(limit, MAX_FORM_LEADS));

  if (tokens.length > 0) {
    query = applyMultiTokenIlikeFilters(query, tokens, FORM_LEAD_SEARCH_FIELDS);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const q = String(req.query.q || '').trim();
  const isQuick = req.query.quick === '1' || req.query.quick === 'true';
  const resultLimit = isQuick ? QUICK_LIMIT : FULL_LIMIT;
  const emptyPayload = { results: [], totalCount: 0, counts: { customers: 0, leads: 0 } };

  res.setHeader('Cache-Control', 'private, max-age=30');

  if (!q) {
    return res.status(200).json(emptyPayload);
  }

  const cacheKey = `global-search:${isQuick ? 'q' : 'f'}:${q.toLowerCase()}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('global-masterlist (cached)', cached);
    return res.status(200).json(cached);
  }

  const qLower = q.toLowerCase();
  const tokens = parseSearchTokens(q);
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    // PostgREST path unions flat customer/sap_lead fields with customer_location /
    // sap_lead_location site text (Other addresses included). Caps: 50 quick / 200 full.
    const perSourceLimit = Math.ceil(resultLimit / 2);

    const [customerBundles, sapLeadBundles, formLeadRowsRaw] = await Promise.all([
      searchCustomersFiltered(supabase, tokens, perSourceLimit),
      searchSapLeadsFiltered(supabase, tokens, perSourceLimit),
      searchFormLeadsFiltered(supabase, tokens, perSourceLimit),
    ]);

    // Server already matched flat fields OR location site text — do not re-filter
    // with flat-only blobs (list rows have no nested AllAddresses).
    const customerResults = customerBundles.map((bundle) =>
      mapMasterlistCustomerToResult(listRowFromSupabaseCustomer(bundle))
    );

    const sapLeadResults = sapLeadBundles.map((bundle) =>
      mapMasterlistLeadToResult(listRowFromSupabaseSapLead(bundle))
    );

    const formLeadRows = [];
    for (const l of formLeadRowsRaw) {
      if (!textMatchesAllSearchTokens(leadRowBlob(l), qLower)) continue;
      formLeadRows.push(mapFormLeadRow(l));
    }

    const results = mergeMasterlistSearchResults(formLeadRows, customerResults, sapLeadResults).slice(
      0,
      resultLimit
    );

    const payload = {
      results,
      totalCount: results.length,
      counts: {
        customers: results.filter((r) => r.type === 'customer').length,
        leads: results.filter((r) => r.type === 'lead').length,
      },
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('global-masterlist', payload);

    return res.status(200).json(payload);
  } catch (e) {
    console.error('global-masterlist:', e);
    return res.status(500).json({ error: e?.message || 'Search failed' });
  }
});

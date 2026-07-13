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
import { customerMatchesListGlobalSearch } from '../../../lib/customers/customerListGlobalSearchFilter';
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

const QUICK_LIMIT = 50;
const FULL_LIMIT = 200;
const MAX_FORM_LEADS = 200;
const CACHE_TTL_MS = 30000;

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

function leadMatchesListGlobalSearch(lead, qLower) {
  const searchableFields = [
    lead.CardCode,
    lead.CardName,
    lead.Phone1,
    lead.Phone2,
    lead.Cellular,
    lead.EmailAddress,
    lead.ContactPerson,
    lead.Address,
    lead.MailAddress,
    lead.Street,
    lead.ZipCode,
    lead.City,
    lead.Country,
    lead.Building,
    lead.BillToBuildingFloorRoom,
    lead.Notes,
    lead.FreeText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return textMatchesAllSearchTokens(searchableFields, qLower);
}

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

async function searchViaRpc(supabase, q, limit) {
  try {
    const { data, error } = await supabase.rpc('search_masterlist', {
      q,
      result_limit: limit,
    });
    if (error || !Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function mapRpcRowsToResults(rpcRows) {
  const customerResults = [];
  const sapLeadResults = [];
  const formLeadRows = [];

  for (const row of rpcRows) {
    const source = String(row.source_type || '').toLowerCase();
    if (source === 'customer') {
      customerResults.push(
        mapMasterlistCustomerToResult({
          CardCode: row.code,
          CardName: row.name,
          Phone1: row.phone,
          EmailAddress: row.email,
          AllAddresses: row.address
            ? [{ Street: row.address, Address1: row.address }]
            : [],
        })
      );
    } else if (source === 'sap_lead') {
      sapLeadResults.push(
        mapMasterlistLeadToResult({
          CardCode: row.code,
          CardName: row.name,
          Phone1: row.phone,
          EmailAddress: row.email,
          Address: row.address,
          Street: row.address,
        })
      );
    } else if (source === 'form_lead') {
      formLeadRows.push(
        mapFormLeadRow({
          id: row.code,
          full_name: row.name,
          email: row.email,
          handphone: row.phone,
          address: row.address,
        })
      );
    }
  }

  return mergeMasterlistSearchResults(formLeadRows, customerResults, sapLeadResults);
}

async function searchCustomersFiltered(supabase, tokens, limit) {
  let query = supabase
    .from('customer')
    .select(SUPABASE_CUSTOMER_LIST_FLAT_SELECT)
    .is('deleted_at', null)
    .order('customer_name', { ascending: true })
    .limit(limit);

  if (tokens.length > 0) {
    query = applyMultiTokenIlikeFilters(query, tokens, CUSTOMER_SEARCH_FIELDS);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function searchSapLeadsFiltered(supabase, tokens, limit) {
  let query = supabase
    .from('sap_lead')
    .select(SUPABASE_SAP_LEAD_LIST_SUMMARY_SELECT)
    .is('deleted_at', null)
    .order('lead_name', { ascending: true })
    .limit(limit);

  if (tokens.length > 0) {
    query = applyMultiTokenIlikeFilters(query, tokens, SAP_LEAD_SEARCH_FIELDS);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
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
    const rpcRows = await searchViaRpc(supabase, q, resultLimit);
    if (rpcRows && rpcRows.length > 0) {
      const results = mapRpcRowsToResults(rpcRows).slice(0, resultLimit);
      const payload = {
        results,
        totalCount: results.length,
        counts: {
          customers: results.filter((r) => r.type === 'customer').length,
          leads: results.filter((r) => r.type === 'lead').length,
        },
      };
      setListCache(cacheKey, payload, CACHE_TTL_MS);
      logResponseSize('global-masterlist (rpc)', payload);
      return res.status(200).json(payload);
    }

    const perSourceLimit = Math.ceil(resultLimit / 2);

    const [customerBundles, sapLeadBundles, formLeadRowsRaw] = await Promise.all([
      searchCustomersFiltered(supabase, tokens, perSourceLimit),
      searchSapLeadsFiltered(supabase, tokens, perSourceLimit),
      searchFormLeadsFiltered(supabase, tokens, perSourceLimit),
    ]);

    const customerResults = [];
    for (const bundle of customerBundles) {
      const c = listRowFromSupabaseCustomer(bundle);
      if (!customerMatchesListGlobalSearch(c, qLower)) continue;
      customerResults.push(mapMasterlistCustomerToResult(c));
    }

    const sapLeadResults = [];
    for (const bundle of sapLeadBundles) {
      const lead = listRowFromSupabaseSapLead(bundle);
      if (!leadMatchesListGlobalSearch(lead, qLower)) continue;
      sapLeadResults.push(mapMasterlistLeadToResult(lead));
    }

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

import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { withSession } from '../../../lib/api/withSession';
import {
  SUPABASE_CUSTOMER_LIST_FLAT_SELECT,
  SUPABASE_CUSTOMER_LOCATION_LIST_SUMMARY_SELECT,
  listRowFromSupabaseCustomer,
} from '../../../lib/customers/supabaseCustomerSapShim';
import { customerMatchesListGlobalSearch } from '../../../lib/customers/customerListGlobalSearchFilter';
import { isPortalCustomerCode } from '../../../lib/customers/promotePortalCustomerCodes';
import { applySapCustomerMasterlistFilters } from '../../../lib/customers/sapMasterlistCustomerQuery';
import {
  applyMultiTokenIlikeFilters,
  getListCache,
  logResponseSize,
  paginatedSelect,
  parseSearchTokens,
  setListCache,
} from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 45000;
const COUNTRY_STATS_CACHE_TTL_MS = 12 * 60 * 1000;
const CUSTOMER_SEARCH_FIELDS = [
  'customer_code',
  'customer_name',
  'phone_number',
  'email',
  'customer_address',
];

async function fetchCountryStats(supabase) {
  const cacheKey = 'customers-country-stats';
  const cached = getListCache(cacheKey, COUNTRY_STATS_CACHE_TTL_MS);
  if (cached) return cached;

  const { data, error } = await supabase.rpc('customer_location_country_stats');

  if (!error && Array.isArray(data) && data.length > 0) {
    const row = data[0];
    const stats = {
      addressCount: Number(row.address_count) || 0,
      topCountry: row.top_country || '',
      topCountryCount: Number(row.top_country_count) || 0,
    };
    setListCache(cacheKey, stats, COUNTRY_STATS_CACHE_TTL_MS);
    return stats;
  }

  const countryCounts = new Map();
  let addressCount = 0;
  const PAGE_SIZE = 1000;
  let rangeFrom = 0;

  for (;;) {
    const { data: rows, error: scanError } = await supabase
      .from('customer_location')
      .select('country_name')
      .not('country_name', 'is', null)
      .range(rangeFrom, rangeFrom + PAGE_SIZE - 1);

    if (scanError) {
      console.warn('customers masterlist-summary country stats:', scanError.message);
      return { addressCount: 0, topCountry: '', topCountryCount: 0 };
    }
    if (!rows?.length) break;

    for (const row of rows) {
      addressCount += 1;
      const key = (row.country_name || '').trim();
      if (!key) continue;
      countryCounts.set(key, (countryCounts.get(key) || 0) + 1);
    }
    if (rows.length < PAGE_SIZE) break;
    rangeFrom += PAGE_SIZE;
  }

  let topCountry = '';
  let topCountryCount = 0;
  for (const [country, count] of countryCounts) {
    if (count > topCountryCount) {
      topCountry = country;
      topCountryCount = count;
    }
  }

  const stats = { addressCount, topCountry, topCountryCount };
  setListCache(cacheKey, stats, COUNTRY_STATS_CACHE_TTL_MS);
  return stats;
}

const LOCATION_SUMMARY_CHUNK = 120;

async function fetchLocationSummariesByCustomerIds(supabase, customerIds) {
  const byCustomerId = new Map();
  const uniqueIds = [...new Set((customerIds || []).filter(Boolean))];
  if (!uniqueIds.length) return byCustomerId;

  for (let i = 0; i < uniqueIds.length; i += LOCATION_SUMMARY_CHUNK) {
    const chunk = uniqueIds.slice(i, i + LOCATION_SUMMARY_CHUNK);
    const { data, error } = await supabase
      .from('customer_location')
      .select(SUPABASE_CUSTOMER_LOCATION_LIST_SUMMARY_SELECT)
      .in('customer_id', chunk);

    if (error) {
      console.warn('customers masterlist-summary location summaries:', error.message);
      break;
    }

    for (const row of data || []) {
      if (!row.customer_id) continue;
      if (!byCustomerId.has(row.customer_id)) byCustomerId.set(row.customer_id, []);
      byCustomerId.get(row.customer_id).push(row);
    }
  }

  return byCustomerId;
}

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 200);
  const search = String(req.query.search || '').trim();
  const country = String(req.query.country || '').trim();
  const sort = String(req.query.sort || 'customer_code');
  const sortAsc = req.query.sortDir !== 'desc';

  const cacheKey = `customers-summary:${page}:${limit}:${search}:${country}:${sort}:${sortAsc}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('customers/masterlist-summary (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const tokens = parseSearchTokens(search);

    const listSelect = country
      ? `${SUPABASE_CUSTOMER_LIST_FLAT_SELECT.trim()}, customer_location!inner(country_name)`
      : SUPABASE_CUSTOMER_LIST_FLAT_SELECT;

    const { data: dbRows, totalCount } = await paginatedSelect(
      supabase,
      'customer',
      listSelect,
      {
        page,
        limit,
        order: { column: sort === 'customer_name' ? 'customer_name' : 'customer_code', ascending: sortAsc },
        filters: (query) => {
          let q = applySapCustomerMasterlistFilters(query);
          if (tokens.length > 0) {
            q = applyMultiTokenIlikeFilters(q, tokens, CUSTOMER_SEARCH_FIELDS);
          }
          if (country) {
            q = q.filter('customer_location.country_name', 'ilike', `%${country}%`);
          }
          return q;
        },
      }
    );

    const locationSummariesByCustomerId = await fetchLocationSummariesByCustomerIds(
      supabase,
      dbRows.map((row) => row.id)
    );

    let customers = dbRows.map((row) => {
      const { customer_location: _filterJoin, ...flatRow } = row;
      return listRowFromSupabaseCustomer({
        ...flatRow,
        customer_location: locationSummariesByCustomerId.get(row.id) || [],
      });
    });

    customers = customers.filter((c) => !isPortalCustomerCode(c.CardCode));

    if (search) {
      const qLower = search.toLowerCase();
      customers = customers.filter((c) => customerMatchesListGlobalSearch(c, qLower));
    }

    const stats = page === 1 && !search && !country ? await fetchCountryStats(supabase) : getListCache('customers-country-stats', COUNTRY_STATS_CACHE_TTL_MS) || { addressCount: 0, topCountry: '', topCountryCount: 0 };

    const { count: customerCount } = await applySapCustomerMasterlistFilters(
      supabase
        .from('customer')
        .select('customer_code', { count: 'exact', head: true })
        .is('deleted_at', null)
    );

    const payload = {
      customers,
      totalCount: search ? customers.length : totalCount,
      customerCount: customerCount ?? totalCount,
      ...stats,
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('customers/masterlist-summary', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Customers masterlist-summary API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load customers summary.',
    });
  }
});

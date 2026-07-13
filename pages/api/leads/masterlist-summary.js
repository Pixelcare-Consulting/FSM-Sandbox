import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { withSession } from '../../../lib/api/withSession';
import {
  SUPABASE_SAP_LEAD_LIST_SUMMARY_SELECT,
  listRowFromSupabaseSapLead,
} from '../../../lib/leads/supabaseLeadSapShim';
import { textMatchesAllSearchTokens } from '../../../lib/utils/multiTokenSearch';
import {
  applyMultiTokenIlikeFilters,
  getListCache,
  logResponseSize,
  paginatedSelect,
  parseSearchTokens,
  setListCache,
} from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 45000;

const LEAD_SEARCH_FIELDS = [
  'lead_code',
  'lead_name',
  'phone_number',
  'email',
  'lead_address',
];

function leadSearchBlob(lead) {
  return [
    lead.CardCode,
    lead.CardName,
    lead.Phone1,
    lead.EmailAddress,
    lead.Address,
    lead.Street,
    lead.City,
    lead.Country,
    lead.ContactPerson,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 200);
  const search = String(req.query.search || '').trim();
  const sort = String(req.query.sort || 'lead_code');
  const sortAsc = req.query.sortDir !== 'desc';

  const cacheKey = `leads-summary:${page}:${limit}:${search}:${sort}:${sortAsc}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('leads/masterlist-summary (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const tokens = parseSearchTokens(search);

    const { data: dbRows, totalCount } = await paginatedSelect(
      supabase,
      'sap_lead',
      SUPABASE_SAP_LEAD_LIST_SUMMARY_SELECT,
      {
        page,
        limit,
        order: { column: sort === 'lead_name' ? 'lead_name' : 'lead_code', ascending: sortAsc },
        filters: (query) => {
          let q = query.not('lead_code', 'ilike', 'CP%');
          if (tokens.length === 0) return q;
          return applyMultiTokenIlikeFilters(q, tokens, LEAD_SEARCH_FIELDS);
        },
      }
    );

    let leads = dbRows.map(listRowFromSupabaseSapLead);

    if (search) {
      const qLower = search.toLowerCase();
      leads = leads.filter((lead) => textMatchesAllSearchTokens(leadSearchBlob(lead), qLower));
    }

    const payload = {
      leads,
      totalCount: search ? leads.length : totalCount,
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('leads/masterlist-summary', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Leads masterlist-summary API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load leads summary.',
    });
  }
});

import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { fetchLocationsReportServer } from '../../../lib/supabase/reports';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 60000;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const search = String(req.query.search || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 200), 500);

  const cacheKey = `reports-warehouse-list:${page}:${limit}:${search}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/warehouse-list (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { data, totalCount, error } = await fetchLocationsReportServer(supabase, {
      page,
      limit,
      search,
    });
    if (error) throw error;

    const payload = {
      rows: data || [],
      totalCount: totalCount ?? (data?.length || 0),
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/warehouse-list', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports warehouse-list API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load warehouse list report.',
    });
  }
});

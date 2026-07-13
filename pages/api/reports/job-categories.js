import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { fetchJobCategoryAggregates } from '../../../lib/supabase/reports';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 120000;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const search = String(req.query.search || '').trim();

  const cacheKey = `reports-job-categories:${search}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/job-categories (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { data, error } = await fetchJobCategoryAggregates(supabase, { search });
    if (error) throw error;

    const payload = {
      rows: data || [],
      totalCount: (data || []).length,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/job-categories', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports job-categories API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load job categories report.',
    });
  }
});

import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import {
  fetchJobsForMonthlyCharts,
  fetchTechniciansWithJobsInYear,
} from '../../../lib/supabase/reports';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 120000;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=60');

  const year = Number(req.query.year) || new Date().getFullYear();
  const cacheKey = `reports-monthly-charts:${year}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/monthly-charts (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { byMonth, data: jobsInYear, error: e1 } = await fetchJobsForMonthlyCharts(supabase, year);
    if (e1) throw e1;

    const statusMap = new Map();
    for (const j of jobsInYear || []) {
      const k = j.status || 'Unknown';
      statusMap.set(k, (statusMap.get(k) || 0) + 1);
    }
    const statusDist = Array.from(statusMap.entries()).sort((a, b) => b[1] - a[1]);

    const { data: techList, error: e2 } = await fetchTechniciansWithJobsInYear(supabase, year);
    if (e2) throw e2;

    const payload = {
      year,
      byMonth: byMonth || [],
      statusDist,
      techList: techList || [],
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/monthly-charts', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports monthly-charts API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load monthly chart data.',
    });
  }
});

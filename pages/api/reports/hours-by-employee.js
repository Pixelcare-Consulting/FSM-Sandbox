import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { fetchAttendanceForPeriod } from '../../../lib/supabase/reports';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 60000;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const startIso = String(req.query.startIso || '').trim();
  const endIso = String(req.query.endIso || '').trim();

  if (!startIso || !endIso) {
    return res.status(400).json({ error: 'startIso and endIso are required' });
  }

  const cacheKey = `reports-hours-by-employee:${startIso}:${endIso}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/hours-by-employee (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { data, error } = await fetchAttendanceForPeriod(supabase, startIso, endIso);
    if (error) throw error;

    const payload = {
      rows: data || [],
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/hours-by-employee', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports hours-by-employee API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load hours by employee report.',
    });
  }
});

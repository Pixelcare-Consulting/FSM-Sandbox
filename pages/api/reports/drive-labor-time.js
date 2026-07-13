import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { fetchTechnicianJobsLaborInPeriodServer } from '../../../lib/supabase/reports';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 60000;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const startMs = Number(req.query.startMs);
  const endMs = Number(req.query.endMs);
  const technicianId = String(req.query.technicianId || '').trim();
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 500), 500);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return res.status(400).json({ error: 'startMs and endMs are required' });
  }

  const cacheKey = `reports-drive-labor-time:${startMs}:${endMs}:${technicianId}:${limit}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/drive-labor-time (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { data, error } = await fetchTechnicianJobsLaborInPeriodServer(supabase, startMs, endMs, {
      technicianId: technicianId || undefined,
      limit,
    });
    if (error) throw error;

    const payload = {
      rows: data || [],
      totalCount: (data || []).length,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/drive-labor-time', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports drive-labor-time API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load drive and labor time report.',
    });
  }
});

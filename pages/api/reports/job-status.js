import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import {
  fetchJobsForStatusReport,
  fetchReportTechnicians,
  filterJobsReportRows,
} from '../../../lib/supabase/reports';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 60000;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const status = String(req.query.status || 'All').trim();
  const search = String(req.query.search || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const technicianId = String(req.query.technicianId || '').trim();
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 800), 800);

  const cacheKey = `reports-job-status:${status}:${search}:${dateFrom}:${dateTo}:${technicianId}:${limit}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/job-status (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const [tj, jRes] = await Promise.all([
      fetchReportTechnicians(supabase),
      fetchJobsForStatusReport(supabase, { limit }),
    ]);

    if (tj.error) throw tj.error;
    if (jRes.error) throw jRes.error;

    const filtered = filterJobsReportRows(jRes.data || [], {
      status,
      search,
      dateFrom,
      dateTo,
      technicianId,
    });

    const payload = {
      technicians: tj.data || [],
      rows: filtered.map(({ raw, catDesc, techLabel }) => ({
        raw,
        catDesc,
        techLabel,
      })),
      totalCount: filtered.length,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/job-status', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports job-status API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load job status report.',
    });
  }
});

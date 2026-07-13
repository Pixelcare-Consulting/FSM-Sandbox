import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { fetchFormsReportData } from '../../../lib/supabase/reports';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 60000;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const formType = String(req.query.formType || '').trim();
  const techFilter = String(req.query.techFilter || '').trim();
  const signatureLimit = Math.min(Math.max(1, Number(req.query.signatureLimit) || 150), 300);
  const mediaLimit = Math.min(Math.max(1, Number(req.query.mediaLimit) || 150), 300);

  const cacheKey = `reports-forms:${dateFrom}:${dateTo}:${formType}:${techFilter}:${signatureLimit}:${mediaLimit}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/forms (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const dateFromIso = dateFrom ? new Date(dateFrom).toISOString() : undefined;
    const dateToIso = dateTo
      ? (() => {
          const d = new Date(dateTo);
          d.setHours(23, 59, 59, 999);
          return d.toISOString();
        })()
      : undefined;

    const result = await fetchFormsReportData(supabase, {
      signatureLimit,
      mediaLimit,
      dateFrom: dateFromIso,
      dateTo: dateToIso,
      formType,
      techFilter,
    });
    if (result.error) throw result.error;

    const payload = {
      googleForms: result.googleForms || [],
      signatureRows: result.signatureRows || [],
      mediaRows: result.mediaRows || [],
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/forms', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports forms API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load forms report.',
    });
  }
});

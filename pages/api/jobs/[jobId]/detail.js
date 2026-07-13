import { requireSession } from '../../../../lib/auth/requireSession';
import { fetchJobDetailBundle } from '../../../../lib/jobs/fetchJobDetailBundle';
import { buildJobDetailPayload } from '../../../../lib/jobs/buildJobDetailPayload';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import {
  getListCache,
  invalidateListCache,
  logResponseSize,
  setListCache,
} from '../../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 45_000;
const CACHE_PREFIX = 'job-detail:';

export function buildJobDetailCacheKey(jobId) {
  return `${CACHE_PREFIX}${jobId}`;
}

export function invalidateJobDetailCache(jobId) {
  if (!jobId) {
    invalidateListCache(CACHE_PREFIX);
    return;
  }
  invalidateListCache(buildJobDetailCacheKey(jobId));
}

/**
 * GET /api/jobs/[jobId]/detail
 * Batched job detail graph for JobDetailsPage (server-side, cached 45s).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const { jobId } = req.query;
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required' });
  }

  res.setHeader('Cache-Control', 'private, max-age=45');

  const cacheKey = buildJobDetailCacheKey(jobId);
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('jobs/[jobId]/detail (cached)', cached);
    return res.status(200).json(cached);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const bundle = await fetchJobDetailBundle(supabase, jobId);
    const payload = buildJobDetailPayload(bundle);

    if (!payload.job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('jobs/[jobId]/detail', payload);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[api/jobs/[jobId]/detail]', error);
    return res.status(500).json({
      error: error?.message || 'Failed to load job detail',
    });
  }
}

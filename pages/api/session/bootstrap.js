import { requireSession } from '../../../lib/auth/requireSession';
import { fetchDashboardBootstrap } from '../../../lib/session/dashboardBootstrap';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 300000;
const cacheKeyForUser = (uid) => `dashboard-bootstrap:${uid}`;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');

  const session = await requireSession(req, res);
  if (!session) return;

  const uid = session.user?.id;
  if (uid) {
    const cached = getListCache(cacheKeyForUser(uid), CACHE_TTL_MS);
    if (cached) {
      logResponseSize('session/bootstrap (cached)', cached);
      return res.status(200).json(cached);
    }
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const payload = await fetchDashboardBootstrap(supabase, session.user);

    if (uid) {
      setListCache(cacheKeyForUser(uid), payload, CACHE_TTL_MS);
    }

    logResponseSize('session/bootstrap', payload);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('session/bootstrap API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load dashboard bootstrap.',
    });
  }
}

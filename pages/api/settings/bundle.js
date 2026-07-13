import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { fetchSettingsBundle } from '../../../lib/settings/settingsBundle';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';
import { SETTINGS_BUNDLE_CACHE_KEY } from '../../../lib/supabase/referenceCacheKeys';

const CACHE_TTL_MS = 600000;
const CACHE_KEY = SETTINGS_BUNDLE_CACHE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=60');

  const cached = getListCache(CACHE_KEY, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('settings/bundle (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const payload = await fetchSettingsBundle(supabase);

    setListCache(CACHE_KEY, payload, CACHE_TTL_MS);
    logResponseSize('settings/bundle', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('settings/bundle API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load settings bundle.',
    });
  }
}

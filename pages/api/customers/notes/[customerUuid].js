import { requireSession } from '../../../../lib/auth/requireSession';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { getListCache, logResponseSize, setListCache } from '../../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 30_000;

function mapNoteRow(note) {
  return {
    id: note.id,
    content: note.content,
    userEmail: note.user_email || 'Unknown',
    tags: note.tags || [],
    createdAt: note.created_at || null,
    updatedAt: note.updated_at || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  res.setHeader('Cache-Control', 'private, max-age=30');

  const customerUuid = String(req.query.customerUuid || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);

  if (!customerUuid) {
    return res.status(400).json({ error: 'customerUuid is required' });
  }

  const cacheKey = `customer-notes:${customerUuid}:${page}:${limit}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('customers/notes/[customerUuid] (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from('customer_notes')
      .select('*', { count: 'exact' })
      .eq('customer_id', customerUuid)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('customer notes select:', error);
      return res.status(500).json({ error: error.message });
    }

    const payload = {
      notes: (data || []).map(mapNoteRow),
      totalCount: count ?? 0,
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('customers/notes/[customerUuid]', payload);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('customer notes API:', err);
    return res.status(500).json({
      error: err.message || 'Unable to load customer notes.',
    });
  }
}

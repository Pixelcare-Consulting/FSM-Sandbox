import { withSession } from '../../../lib/api/withSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { getListCache, logResponseSize, paginatedSelect, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 120000;
const EQUIPMENT_LIST_SELECT = `
  id,
  item_name,
  equipment_type,
  item_code,
  manufacturer,
  model,
  serial_number,
  customer_id,
  deleted_at
`;

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=60');

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
  const search = String(req.query.search || '').trim();

  const cacheKey = `reports-products-services:${page}:${limit}:${search}`;
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('reports/products-services (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { data, totalCount } = await paginatedSelect(supabase, 'equipments', EQUIPMENT_LIST_SELECT, {
      page,
      limit,
      order: { column: 'item_name', ascending: true },
      filters: (query) => {
        let q = query;
        if (search) {
          q = q.or(
            `item_name.ilike.%${search}%,equipment_type.ilike.%${search}%,item_code.ilike.%${search}%,manufacturer.ilike.%${search}%`
          );
        }
        return q;
      },
    });

    const payload = {
      equipments: data || [],
      totalCount,
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('reports/products-services', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Reports products-services API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load products/services catalog.',
    });
  }
});

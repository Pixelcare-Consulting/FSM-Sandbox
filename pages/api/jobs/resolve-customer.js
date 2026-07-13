import { requireSession } from '../../../lib/auth/requireSession';
import { customerService } from '../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../lib/supabase/server';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const { cardCode, cardName } = req.body || {};
    const code = String(cardCode || '').trim();
    if (!code) {
      return res.status(400).json({ error: 'cardCode is required' });
    }

    const name = String(cardName || 'Unknown Customer').trim() || 'Unknown Customer';
    const customer = await customerService.findOrCreate(code, name, {}, supabase);

    return res.status(200).json({
      success: true,
      customerId: customer.id,
      customer_code: customer.customer_code,
    });
  } catch (error) {
    console.error('resolve-customer error:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to resolve customer',
    });
  }
}

import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  invalidateListCache('customers-sap-masterlist');
  return res.status(200).json({ ok: true });
}

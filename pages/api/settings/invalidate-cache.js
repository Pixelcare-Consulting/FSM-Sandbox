import { requireSession } from '../../../lib/auth/requireSession';
import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  invalidateListCache('settings-bundle');
  const uid = session.user?.id;
  if (uid) {
    invalidateListCache(`dashboard-bootstrap:${uid}`);
  } else {
    invalidateListCache('dashboard-bootstrap:');
  }

  return res.status(200).json({ ok: true });
}

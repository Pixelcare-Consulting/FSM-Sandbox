import { requireSession } from '../../../../lib/auth/requireSession';
import { invalidateJobDetailCache } from './detail';

/**
 * POST /api/jobs/[jobId]/invalidate-detail-cache
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const { jobId } = req.query;
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required' });
  }

  invalidateJobDetailCache(jobId);
  return res.status(200).json({ ok: true });
}

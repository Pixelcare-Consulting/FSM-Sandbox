import { requireSession } from '../../../../lib/auth/requireSession';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { jobService } from '../../../../lib/supabase/database';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
  buildChanges,
} from '../../../../lib/services/auditLog';
import { MANUAL_SOURCE, recordJobPayment } from '../../../../lib/services/jobPaymentReconciliation';

/**
 * POST /api/jobs/[jobId]/mark-paid
 * Manual PayNow reconciliation — ops confirms payment in bank portal.
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

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (e) {
    console.warn('[mark-paid]', e?.message);
    return res.status(503).json({ error: 'Server misconfigured' });
  }

  const job = await jobService.findById(jobId, supabase);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const amountCentsRaw = body.amount_cents ?? body.amountCents;
  const parsedAmount = amountCentsRaw != null && amountCentsRaw !== ''
    ? Number(amountCentsRaw)
    : job.payment_qr_amount != null
      ? Math.round(Number(job.payment_qr_amount) * 100)
      : null;

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      error: 'amount_cents is required (positive integer cents) when job has no payment_qr_amount',
    });
  }

  const amountCents = Math.round(parsedAmount);
  const bankReference = body.bank_reference ?? body.bankReference ?? null;
  const paidAt = body.paid_at ?? body.paidAt ?? null;

  try {
    const result = await recordJobPayment(supabase, {
      jobId,
      job,
      amountCents,
      source: MANUAL_SOURCE,
      bankReference,
      paidAt,
      rawPayload: { markedBy: session.user?.id, markedByEmail: session.user?.email },
      idempotent: false,
    });

    void writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.JOB_PAYMENT_RECEIVED,
      category: AUDIT_CATEGORIES.JOB,
      entityType: 'job',
      entityId: jobId,
      entityLabel: job.job_number || jobId,
      description: 'Job marked as paid (manual)',
      details: {
        source: MANUAL_SOURCE,
        amount_cents: amountCents,
        bank_reference: bankReference || null,
        duplicate: result.duplicate,
      },
      changes: buildChanges(
        { payment_status: job.payment_status || 'pending' },
        { payment_status: result.paymentStatus }
      ),
      status: AUDIT_STATUS.SUCCESS,
    });

    return res.status(200).json({
      ok: true,
      payment: result.payment,
      payment_status: result.paymentStatus,
      duplicate: result.duplicate,
    });
  } catch (e) {
    console.error('[mark-paid]', e);
    return res.status(500).json({ error: e?.message || 'Failed to mark job as paid' });
  }
}

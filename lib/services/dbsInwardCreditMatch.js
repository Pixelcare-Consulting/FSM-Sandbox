/**
 * Match DBS RAPID inward credit webhook payloads to FSM jobs.
 * Reference may appear in customerReference, narrative, endToEndId, or transactionReference.
 */

const REF_FIELD_CANDIDATES = [
  'customerReference',
  'customer_reference',
  'narrative',
  'transactionReference',
  'transaction_reference',
  'endToEndId',
  'end_to_end_id',
  'reference',
  'refNumber',
  'ref_number',
];

/**
 * @param {unknown} payload
 * @returns {string[]}
 */
export function extractReferenceTokens(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const tokens = new Set();

  for (const key of REF_FIELD_CANDIDATES) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      tokens.add(value.trim());
    }
  }

  const nested = payload.transaction || payload.credit || payload.data;
  if (nested && typeof nested === 'object' && nested !== payload) {
    for (const token of extractReferenceTokens(nested)) {
      tokens.add(token);
    }
  }

  return [...tokens];
}

/**
 * @param {string} haystack
 * @param {string} needle
 */
function containsRef(haystack, needle) {
  if (!haystack || !needle) return false;
  return haystack.toUpperCase().includes(String(needle).trim().toUpperCase());
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} payload
 * @returns {Promise<{ job: object | null, matchedReference: string | null, matchField: string | null }>}
 */
export async function findJobByInwardCredit(supabase, payload) {
  const tokens = extractReferenceTokens(payload);
  if (!tokens.length) {
    return { job: null, matchedReference: null, matchField: null };
  }

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, job_number, payment_qr_ref_number, payment_qr_inv_number, payment_qr_amount, payment_status')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Failed to load jobs for inward credit match: ${error.message}`);
  }

  const rows = jobs || [];

  for (const token of tokens) {
    const exact = rows.find(
      (j) =>
        j.job_number === token ||
        j.payment_qr_ref_number === token ||
        j.payment_qr_inv_number === token
    );
    if (exact) {
      return { job: exact, matchedReference: token, matchField: 'exact' };
    }
  }

  for (const token of tokens) {
    const partial = rows.find(
      (j) =>
        containsRef(token, j.job_number) ||
        containsRef(token, j.payment_qr_ref_number) ||
        containsRef(token, j.payment_qr_inv_number)
    );
    if (partial) {
      return { job: partial, matchedReference: token, matchField: 'contains' };
    }
  }

  return { job: null, matchedReference: tokens[0] || null, matchField: null };
}

/**
 * @param {unknown} payload
 * @returns {number | null} amount in cents
 */
export function extractAmountCents(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const raw =
    payload.amountCents ??
    payload.amount_cents ??
    payload.transactionAmount ??
    payload.transaction_amount ??
    payload.amount ??
    payload.creditAmount ??
    payload.credit_amount;

  if (raw == null || raw === '') return null;

  const num = Number(raw);
  if (!Number.isFinite(num)) return null;

  if (Number.isInteger(num) && Math.abs(num) >= 100) {
    return Math.round(num);
  }

  return Math.round(num * 100);
}

/**
 * @param {string | null | undefined} bankReference
 */
export function normalizeBankReference(bankReference) {
  if (!bankReference) return null;
  const trimmed = String(bankReference).trim();
  return trimmed || null;
}

/**
 * @param {object} job
 * @param {number} newPaymentCents
 * @param {number} [existingTotalCents=0]
 * @returns {'paid' | 'partial' | 'pending'}
 */
export function derivePaymentStatus(job, newPaymentCents, existingTotalCents = 0) {
  const expected = job?.payment_qr_amount != null
    ? Math.round(Number(job.payment_qr_amount) * 100)
    : null;
  const total = existingTotalCents + newPaymentCents;

  if (expected == null || expected <= 0) {
    return 'paid';
  }

  if (total >= expected) {
    return 'paid';
  }

  if (total > 0) {
    return 'partial';
  }

  return 'pending';
}

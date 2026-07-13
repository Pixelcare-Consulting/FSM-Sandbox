/**
 * Portal duplicate detection by normalized email / phone (last 8 digits).
 */

export function normalizeContactEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function normalizeContactPhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function phonesMatchLast8(a, b) {
  const da = normalizeContactPhoneDigits(a);
  const db = normalizeContactPhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 8 && db.length >= 8) {
    return da.slice(-8) === db.slice(-8);
  }
  return false;
}

function rowMatchesContact(row, emailNorm, phoneDigits) {
  const rowEmail = normalizeContactEmail(row?.email);
  if (emailNorm && rowEmail && rowEmail === emailNorm) return true;
  const rowPhone = normalizeContactPhoneDigits(row?.phone_number || row?.handphone);
  if (phoneDigits && rowPhone && phonesMatchLast8(phoneDigits, rowPhone)) return true;
  return false;
}

/**
 * @returns {Promise<{ existingCode: string, existingType: 'customer'|'lead', suggestion: 'view'|'link', existingId?: string } | null>}
 */
export async function findPortalDuplicate(supabase, { email, phone, excludeCustomerId } = {}) {
  const emailNorm = normalizeContactEmail(email);
  const phoneDigits = normalizeContactPhoneDigits(phone);
  if (!emailNorm && !phoneDigits) return null;

  let customerQuery = supabase
    .from('customer')
    .select('id, customer_code, email, phone_number')
    .is('deleted_at', null);
  if (excludeCustomerId) {
    customerQuery = customerQuery.neq('id', excludeCustomerId);
  }
  const { data: customers, error: cErr } = await customerQuery;
  if (cErr) throw cErr;

  for (const row of customers || []) {
    if (rowMatchesContact(row, emailNorm, phoneDigits)) {
      return {
        existingCode: row.customer_code,
        existingType: 'customer',
        suggestion: 'view',
        existingId: row.id,
      };
    }
  }

  const { data: leads, error: lErr } = await supabase
    .from('leads')
    .select('id, email, handphone, customer_id, customer:customer_id(customer_code)')
    .is('deleted_at', null);
  if (lErr) throw lErr;

  for (const lead of leads || []) {
    if (rowMatchesContact(lead, emailNorm, phoneDigits)) {
      const code = lead.customer?.customer_code || null;
      if (code) {
        return {
          existingCode: code,
          existingType: 'lead',
          suggestion: 'view',
          existingId: lead.id,
        };
      }
    }
  }

  return null;
}

/**
 * Sibling CP rows (same email/phone, different customer_code).
 * @returns {Promise<Array<{ customer_code: string, customer_name: string, email: string|null, phone_number: string|null, lead_id: string|null }>>}
 */
export async function findSiblingPortalCustomers(
  supabase,
  { email, phone, excludeCustomerId, excludeCustomerCode } = {}
) {
  const emailNorm = normalizeContactEmail(email);
  const phoneDigits = normalizeContactPhoneDigits(phone);
  if (!emailNorm && !phoneDigits) return [];

  let query = supabase
    .from('customer')
    .select('id, customer_code, customer_name, email, phone_number, lead_id')
    .is('deleted_at', null);
  if (excludeCustomerId) {
    query = query.neq('id', excludeCustomerId);
  }
  const { data: rows, error } = await query;
  if (error) throw error;

  const excludeCode = String(excludeCustomerCode || '').trim().toUpperCase();
  return (rows || []).filter((row) => {
    if (excludeCode && String(row.customer_code || '').toUpperCase() === excludeCode) {
      return false;
    }
    return rowMatchesContact(row, emailNorm, phoneDigits);
  });
}

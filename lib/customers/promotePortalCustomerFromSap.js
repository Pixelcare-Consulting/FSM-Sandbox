/**
 * Promote a portal CP customer row to the official SAP C CardCode in place.
 * Keeps the same customer UUID so jobs stay linked.
 */

import {
  customerNameSearchVariants,
  normalizeNameForMatch,
} from '../integrations/aifmAssignCustomersCore.js';
import {
  buildCustomerFieldsFromDetails,
  fetchBpDetails,
  upsertCustomerLocationsFromSap,
} from '../integrations/aifmSapMasterlistSync.js';
import {
  assertPromotionSession,
  isOfficialSapCustomerCode,
  isPortalCustomerCode,
  isSyncedPortalCpRow,
  normalizePromotionCode,
  validatePromotionCodes,
} from './promotePortalCustomerCodes.js';

function normalizeCode(raw) {
  return normalizePromotionCode(raw);
}

function normalizePhoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

/**
 * Find a single portal CP customer eligible for promotion to the given SAP C code.
 * Returns null unless exactly one unambiguous match (name, then email/phone tie-break).
 */
export async function resolvePortalCustomerForPromotion(supabase, sapCardCode, sessionCookies) {
  const sapCode = normalizeCode(sapCardCode);
  if (!isOfficialSapCustomerCode(sapCode) || !sessionCookies) return null;

  const details = await fetchBpDetails(sapCode, sessionCookies);
  if (!details?.cardName) return null;

  const byId = new Map();
  const variants = customerNameSearchVariants(details.cardName);

  for (const variant of variants) {
    const { data: exactRows, error: exactErr } = await supabase
      .from('customer')
      .select('id, customer_code, customer_name, email, phone_number, synced_to_sap_at')
      .ilike('customer_name', variant)
      .ilike('customer_code', 'CP%')
      .not('synced_to_sap_at', 'is', null)
      .is('deleted_at', null);
    if (exactErr) throw new Error(`CP candidate lookup failed: ${exactErr.message}`);
    for (const row of exactRows || []) {
      if (isSyncedPortalCpRow(row)) byId.set(row.id, row);
    }
  }

  if (byId.size === 0) {
    const name = normalizeNameForMatch(details.cardName);
    const { data: partialRows, error: partialErr } = await supabase
      .from('customer')
      .select('id, customer_code, customer_name, email, phone_number, synced_to_sap_at')
      .ilike('customer_name', `%${name}%`)
      .ilike('customer_code', 'CP%')
      .not('synced_to_sap_at', 'is', null)
      .is('deleted_at', null)
      .limit(10);
    if (partialErr) throw new Error(`CP partial name lookup failed: ${partialErr.message}`);
    for (const row of partialRows || []) {
      if (isSyncedPortalCpRow(row)) byId.set(row.id, row);
    }
  }

  let candidates = [...byId.values()];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].customer_code;

  const sapEmail = String(details.email || '').trim().toLowerCase();
  if (sapEmail) {
    const byEmail = candidates.filter(
      (row) => String(row.email || '').trim().toLowerCase() === sapEmail
    );
    if (byEmail.length === 1) return byEmail[0].customer_code;
    if (byEmail.length > 0) candidates = byEmail;
  }

  const sapPhone = normalizePhoneDigits(details.phone);
  if (candidates.length > 1 && sapPhone.length >= 8) {
    const byPhone = candidates.filter(
      (row) => normalizePhoneDigits(row.phone_number) === sapPhone
    );
    if (byPhone.length === 1) return byPhone[0].customer_code;
  }

  return null;
}

/**
 * @param {{
 *   supabase: import('@supabase/supabase-js').SupabaseClient,
 *   sessionCookies: object,
 *   portalCustomerCode: string,
 *   sapCardCode: string,
 * }} params
 */
export async function promotePortalCustomerFromSap({
  supabase,
  sessionCookies,
  portalCustomerCode,
  sapCardCode,
}) {
  const { portalCode, sapCode } = validatePromotionCodes(portalCustomerCode, sapCardCode);

  assertPromotionSession(sessionCookies);

  const { data: portalCustomer, error: portalErr } = await supabase
    .from('customer')
    .select('id, customer_code, customer_name, customer_address, synced_to_sap_at')
    .eq('customer_code', portalCode)
    .is('deleted_at', null)
    .maybeSingle();
  if (portalErr) throw new Error(`Portal customer lookup failed: ${portalErr.message}`);
  if (!portalCustomer?.id) {
    throw new Error(`Portal customer ${portalCode} not found`);
  }
  if (!portalCustomer.synced_to_sap_at) {
    throw new Error(
      `Portal customer ${portalCode} has not been synced to SAP yet (synced_to_sap_at is null)`
    );
  }

  const details = await fetchBpDetails(sapCode, sessionCookies);
  if (!details?.cardCode) {
    throw new Error(`SAP Business Partner ${sapCode} not confirmed on Service Layer`);
  }

  const customer_name = details.cardName || portalCustomer.customer_name || details.cardCode;
  const patch = buildCustomerFieldsFromDetails(customer_name, details, {
    existingAddress: portalCustomer.customer_address,
  });
  patch.customer_code = details.cardCode;
  // Promote CP→C must appear in SAP masterlist dropdown (source=sap|null only).
  patch.source = 'sap';

  const { error: updErr } = await supabase
    .from('customer')
    .update(patch)
    .eq('id', portalCustomer.id);
  if (updErr) {
    throw new Error(`Failed to promote ${portalCode} → ${details.cardCode}: ${updErr.message}`);
  }

  const locations = details.bpAddresses?.length
    ? await upsertCustomerLocationsFromSap(supabase, portalCustomer.id, details.bpAddresses, {
        billToDefault: details.billToDefault,
        shipToDefault: details.shipToDefault,
      })
    : { inserted: 0, updated: 0 };

  let duplicateCleanup = null;
  const { data: duplicateRow, error: dupSelErr } = await supabase
    .from('customer')
    .select('id, customer_code')
    .eq('customer_code', details.cardCode)
    .neq('id', portalCustomer.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (dupSelErr) throw new Error(`Duplicate customer lookup failed: ${dupSelErr.message}`);

  if (duplicateRow?.id) {
    const { count: jobCount, error: jobCountErr } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', duplicateRow.id)
      .is('deleted_at', null);
    if (jobCountErr) throw new Error(`Job count for duplicate row failed: ${jobCountErr.message}`);

    if ((jobCount || 0) > 0) {
      duplicateCleanup = {
        duplicateId: duplicateRow.id,
        action: 'skipped',
        reason: `${jobCount} job(s) still linked to duplicate row`,
      };
    } else {
      const { error: softDelErr } = await supabase
        .from('customer')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', duplicateRow.id);
      if (softDelErr) {
        throw new Error(`Failed to soft-delete duplicate ${details.cardCode}: ${softDelErr.message}`);
      }
      duplicateCleanup = {
        duplicateId: duplicateRow.id,
        action: 'soft_deleted',
      };
    }
  }

  return {
    action: 'promoted',
    from: portalCode,
    to: details.cardCode,
    id: portalCustomer.id,
    customer_name,
    locations,
    duplicateCleanup,
  };
}

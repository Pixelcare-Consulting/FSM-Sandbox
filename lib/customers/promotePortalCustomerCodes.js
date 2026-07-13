/**
 * Pure CardCode validation for CP→C promotion (no SAP/DB dependencies).
 */

export function normalizePromotionCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

export function isPortalCustomerCode(code) {
  return /^CP\d+$/i.test(normalizePromotionCode(code));
}

/** Official SAP customer CardCodes only (not L leads or portal CP codes). */
export function isOfficialSapCustomerCode(code) {
  const normalized = normalizePromotionCode(code);
  if (isPortalCustomerCode(normalized)) return false;
  return /^C[A-Z0-9]+$/.test(normalized);
}

export function validatePromotionCodes(portalCustomerCode, sapCardCode) {
  const portalCode = normalizePromotionCode(portalCustomerCode);
  const sapCode = normalizePromotionCode(sapCardCode);

  if (!isPortalCustomerCode(portalCode)) {
    throw new Error(
      `Invalid portal customer code: ${portalCustomerCode} (expected CP#####)`
    );
  }
  if (!isOfficialSapCustomerCode(sapCode)) {
    throw new Error(`Invalid SAP CardCode: ${sapCardCode} (expected official C code, not L)`);
  }

  return { portalCode, sapCode };
}

export function isSyncedPortalCpRow(row) {
  return isPortalCustomerCode(row?.customer_code) && Boolean(row?.synced_to_sap_at);
}

export function assertPromotionSession(sessionCookies) {
  if (!sessionCookies) {
    throw new Error('SAP session unavailable — promotion requires live SAP lookup');
  }
}

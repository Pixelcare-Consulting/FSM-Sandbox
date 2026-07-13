/**
 * Unit tests for CP→C promotion helpers.
 *
 * Manual UAT (end-to-end promotion):
 * 1. Portal Customers: create CP##### (e.g. CP00125) with jobs; Convert to SAP → customer_code stays CP, sap_card_code = L*.
 * 2. SAP B1: staff promotes Lead → Customer → new C##### (e.g. C004512).
 * 3. SAP Customers page: Sync from SAP with C004512 (optional Portal CP code CP00125 if auto-match fails).
 * 4. Expect toast "Promoted CP00125 → C004512"; masterlist row shows C004512; jobs still linked via customer_id.
 * 5. Create Job after promotion: primary cardCode is C#####; historical jobs remain on same customer.
 */

import assert from 'node:assert/strict';
import {
  assertPromotionSession,
  isOfficialSapCustomerCode,
  isPortalCustomerCode,
  isSyncedPortalCpRow,
  normalizePromotionCode,
  validatePromotionCodes,
} from '../lib/customers/promotePortalCustomerCodes.js';

assert.equal(normalizePromotionCode('  cp00125 '), 'CP00125');

assert.equal(isPortalCustomerCode('CP00125'), true);
assert.equal(isPortalCustomerCode('cp99'), true);
assert.equal(isPortalCustomerCode('C004512'), false);
assert.equal(isPortalCustomerCode('L00438'), false);
assert.equal(isPortalCustomerCode('CP'), false);

assert.equal(isOfficialSapCustomerCode('C004512'), true);
assert.equal(isOfficialSapCustomerCode('C006104'), true);
assert.equal(isOfficialSapCustomerCode('L00438'), false);
assert.equal(isOfficialSapCustomerCode('CP00125'), false);

assert.deepEqual(validatePromotionCodes('cp00125', 'c004512'), {
  portalCode: 'CP00125',
  sapCode: 'C004512',
});

assert.equal(
  isSyncedPortalCpRow({ customer_code: 'CP00125', synced_to_sap_at: '2026-01-01T00:00:00Z' }),
  true
);
assert.equal(isSyncedPortalCpRow({ customer_code: 'CP00125', synced_to_sap_at: null }), false);
assert.equal(isSyncedPortalCpRow({ customer_code: 'C004512', synced_to_sap_at: '2026-01-01' }), false);

assert.throws(
  () => validatePromotionCodes('C004512', 'C004512'),
  /Invalid portal customer code.*CP#####/
);
assert.throws(
  () => validatePromotionCodes('CP00125', 'L000123'),
  /expected official C code, not L/
);
assert.throws(
  () => validatePromotionCodes('CP', 'C004512'),
  /Invalid portal customer code/
);
assert.throws(() => assertPromotionSession(null), /SAP session unavailable/);
assert.doesNotThrow(() => assertPromotionSession({}));

console.log('promotePortalCustomerFromSap.test.mjs: ok');

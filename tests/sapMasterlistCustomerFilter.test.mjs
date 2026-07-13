/**
 * Unit tests for SAP masterlist CP exclusion rules.
 */

import assert from 'node:assert/strict';
import {
  isOfficialSapCustomerCode,
  isPortalCustomerCode,
} from '../lib/customers/promotePortalCustomerCodes.js';
import { applySapCustomerMasterlistFilters } from '../lib/customers/sapMasterlistCustomerQuery.js';

function isIncludedInSapMasterlist(row) {
  return !isPortalCustomerCode(row?.customer_code);
}

assert.equal(isPortalCustomerCode('CP00016'), true);
assert.equal(isIncludedInSapMasterlist({ customer_code: 'CP00016' }), false);

assert.equal(isOfficialSapCustomerCode('C004512'), true);
assert.equal(isIncludedInSapMasterlist({ customer_code: 'C004512' }), true);

const promotedRow = { customer_code: 'C004512', source: 'portal' };
assert.equal(isPortalCustomerCode(promotedRow.customer_code), false);
assert.equal(isOfficialSapCustomerCode(promotedRow.customer_code), true);
assert.equal(isIncludedInSapMasterlist(promotedRow), true);

let notCalls = [];
const mockQuery = {
  not(column, operator, pattern) {
    notCalls.push({ column, operator, pattern });
    return this;
  },
};

const filteredQuery = applySapCustomerMasterlistFilters(mockQuery);
assert.equal(filteredQuery, mockQuery);
assert.deepEqual(notCalls, [{ column: 'customer_code', operator: 'ilike', pattern: 'CP%' }]);

console.log('sapMasterlistCustomerFilter.test.mjs: ok');

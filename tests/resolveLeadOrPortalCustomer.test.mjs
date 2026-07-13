import assert from 'node:assert/strict';
import {
  isValidUuid,
  parsePortalSyntheticCustomerId,
  syntheticLeadFromCustomer,
} from '../lib/leads/portalSyntheticLead.js';

const sampleUuid = 'b46e856e-d8a4-4fe3-96fe-6e94a7a9ccde';

assert.equal(isValidUuid(sampleUuid), true);
assert.equal(isValidUuid('not-a-uuid'), false);
assert.equal(isValidUuid('cust-' + sampleUuid), false);

assert.equal(parsePortalSyntheticCustomerId(`cust-${sampleUuid}`), sampleUuid);
assert.equal(parsePortalSyntheticCustomerId('cust-not-valid'), null);
assert.equal(parsePortalSyntheticCustomerId(sampleUuid), null);
assert.equal(parsePortalSyntheticCustomerId(''), null);

const customer = {
  id: sampleUuid,
  customer_name: 'Portal User',
  email: 'user@example.com',
  phone_number: '6591234567',
  block: '188',
  unit: '#01-03',
  customer_address: '188 Race Course Road',
  notes: 'Test note',
  customer_code: 'CP00032',
  synced_to_sap_at: null,
  sap_card_code: null,
};

const synthetic = syntheticLeadFromCustomer(customer);
assert.equal(synthetic.id, `cust-${sampleUuid}`);
assert.equal(synthetic.full_name, 'Portal User');
assert.equal(synthetic.customer_id, sampleUuid);
assert.equal(synthetic.first_service_date, null);
assert.equal(synthetic.block, '188');
assert.equal(synthetic.notes, 'Test note');
assert.equal(synthetic.status, 'PENDING');

const converted = syntheticLeadFromCustomer({
  ...customer,
  synced_to_sap_at: '2026-01-01T00:00:00.000Z',
  sap_card_code: 'L00001',
});
assert.equal(converted.status, 'CONVERTED');

console.log('resolveLeadOrPortalCustomer.test.mjs: ok');

import assert from 'node:assert/strict';
import {
  mapODataServiceCallRow,
  mapSapServiceCallRow,
  mergeServiceCallsFromCardCodes,
} from '../lib/customers/sapServiceCallRowMap.js';

const odataRow = mapODataServiceCallRow({
  ServiceCallID: 15050,
  Subject: 'AC repair',
  CustomerName: 'Test Co',
  CreateDate: '2026-01-01',
  CreateTime: '10:00:00',
  Description: 'Unit 01',
});
assert.equal(odataRow.serviceCallID, 15050);
assert.equal(odataRow.subject, 'AC repair');

const sqlRow = mapSapServiceCallRow({
  ServiceCallID: '15051',
  Subject: 'PM visit',
});
assert.equal(sqlRow.serviceCallID, 15051);

const merged = mergeServiceCallsFromCardCodes([
  {
    cardCode: 'CP00125',
    serviceCalls: [{ serviceCallID: 1, subject: 'A' }],
  },
  {
    cardCode: 'L00438',
    serviceCalls: [
      { serviceCallID: 1, subject: 'A' },
      { serviceCallID: 2, subject: 'B' },
    ],
  },
]);
assert.equal(merged.length, 2);
assert.equal(merged[0].fetchedForCardCode, 'CP00125');
assert.equal(merged[1].fetchedForCardCode, 'L00438');

console.log('sapServiceCallODataMap.test.mjs: ok');

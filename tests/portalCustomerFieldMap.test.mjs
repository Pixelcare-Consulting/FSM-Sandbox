import assert from 'node:assert/strict';
import {
  mapCreatePayloadToCustomerFields,
  mapCreatePayloadToLeadShape,
  mapCreatePayloadToContacts,
  mapCreatePayloadToExtraLocations,
} from '../lib/customers/portalCustomerFieldMap.js';

const payload = {
  CardName: 'Jane Doe',
  Phone1: '6591234567',
  Phone2: null,
  EmailAddress: 'jane@example.com',
  Block: '188',
  Unit: '#01-03',
  FreeText: 'VIP customer',
  BPAddresses: [
    {
      AddressType: 'bo_BillTo',
      AddressName: '#01-03 SOHO',
      Street: '188 Race Course Road',
      BuildingFloorRoom: '#01-03',
      ZipCode: '218612',
      Country: 'SG',
      Block: '188',
    },
    {
      AddressType: 'bo_ShipTo',
      AddressName: '#01-03 SOHO - T',
      Street: '188 Race Course Road',
      ZipCode: '218612',
      Country: 'SG',
    },
    {
      AddressType: 'bo_ShipTo',
      AddressName: 'Warehouse',
      Street: '10 Industrial Road',
      ZipCode: '123456',
      Country: 'SG',
    },
  ],
  ContactEmployees: [
    {
      Name: 'Contact1',
      FirstName: 'Jane',
      LastName: 'Doe',
      Phone1: '6591234567',
      E_Mail: 'jane@example.com',
    },
  ],
};

const customerFields = mapCreatePayloadToCustomerFields(payload, 'CP00099');
assert.equal(customerFields.customer_code, 'CP00099');
assert.equal(customerFields.customer_name, 'Jane Doe');
assert.equal(customerFields.block, '188');
assert.equal(customerFields.unit, '#01-03');
assert.equal(customerFields.notes, 'VIP customer');
assert.equal(customerFields.source, 'portal');

const leadShape = mapCreatePayloadToLeadShape(payload);
assert.equal(leadShape.full_name, 'Jane Doe');
assert.equal(leadShape.street, '188 Race Course Road');
assert.equal(leadShape.postcode, '218612');

const contacts = mapCreatePayloadToContacts(payload);
assert.equal(contacts.length, 1);
assert.equal(contacts[0].first_name, 'Jane');
assert.equal(contacts[0].last_name, 'Doe');

const extras = mapCreatePayloadToExtraLocations(payload);
assert.equal(extras.length, 1);
assert.equal(extras[0].siteId, 'Warehouse');

console.log('portalCustomerFieldMap.test.mjs: ok');

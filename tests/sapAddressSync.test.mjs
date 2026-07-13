import assert from 'node:assert/strict';

import {
  formatSapAddressLine,
  resolveSapBuildingLine,
  mergeCustomerLocationRow,
  findExistingLocationRow,
  shouldPreferExistingLocationField,
} from '../lib/integrations/sapAddressLocationHelpers.js';
import { computeAddressChangesForEntity } from '../lib/integrations/sapDeltaSyncAddressPreview.js';
import {
  formatPortalBpAddressSubtitle,
  sanitizeAddressPart,
} from '../lib/utils/formatPortalBpAddress.js';

// HILLION RESIDENCES — unit in AddressName, empty Building
const hillionSap = {
  AddressName: '#16-24 HILLION RESIDENCES',
  AddressType: 'bo_ShipTo',
  Street: '10 JELEBU ROAD',
  Building: '',
  ZipCode: '677672',
  Country: 'SG',
};

assert.equal(resolveSapBuildingLine(hillionSap), '#16-24 HILLION RESIDENCES');
assert.equal(
  formatSapAddressLine(hillionSap),
  '10 JELEBU ROAD, #16-24 HILLION RESIDENCES, Singapore, 677672'
);

// ION ORCHARD — Building populated
const ionSap = {
  AddressName: '#55-01 ION ORCHARD',
  AddressType: 'bo_ShipTo',
  Street: '2 ORCHARD TURN',
  Building: '#55-01 ION ORCHARD (1 ATICO)',
  ZipCode: '238801',
  Country: 'SG',
};

assert.equal(resolveSapBuildingLine(ionSap), '#55-01 ION ORCHARD (1 ATICO)');
assert.equal(
  formatSapAddressLine(ionSap),
  '2 ORCHARD TURN, #55-01 ION ORCHARD (1 ATICO), Singapore, 238801'
);

// SHAW HOUSE — unit only in AddressName
const shawSap = {
  AddressName: '#03-K1/K2 SHAW HOUSE SUSHIRO ISETAN SCOTTS',
  Street: '350 ORCHARD ROAD',
  Building: '',
  ZipCode: '238868',
  Country: 'SG',
};

assert.equal(
  formatSapAddressLine(shawSap),
  '350 ORCHARD ROAD, #03-K1/K2 SHAW HOUSE SUSHIRO ISETAN SCOTTS, Singapore, 238868'
);

// merge — preserve longer portal address
const existing = {
  address: '350 ORCHARD ROAD, #03-K1/K2 SHAW HOUSE SUSHIRO ISETAN SCOTTS, Singapore, 238868',
  street: '350 ORCHARD ROAD',
  building: '#03-K1/K2 SHAW HOUSE SUSHIRO ISETAN SCOTTS',
};
const incoming = {
  address: '350 ORCHARD ROAD, Singapore, 238868',
  street: '350 ORCHARD ROAD',
  building: '#03-K1/K2 SHAW HOUSE SUSHIRO ISETAN SCOTTS',
  city: null,
  block: null,
  country_name: 'Singapore',
  zip_code: '238868',
  address_type: 'bo_ShipTo',
};

assert.equal(shouldPreferExistingLocationField(existing.address, incoming.address), true);
const merged = mergeCustomerLocationRow(existing, incoming);
assert.equal(merged.address, existing.address);

// ship ` - 1` alias — portal suffix matches SAP site_id
const portalShipSuffix = {
  id: 'loc-1',
  site_id: '#04-10 THE RIVERSIDE PIAZZA - 1',
  address_type: 'bo_ShipTo',
};
const sapShipRow = {
  site_id: '#04-10 THE RIVERSIDE PIAZZA',
  address_type: 'bo_ShipTo',
};
assert.equal(findExistingLocationRow([portalShipSuffix], sapShipRow), portalShipSuffix);

// reverse alias — SAP ship has ` - 1`
const portalShipBase = {
  id: 'loc-2',
  site_id: '#04-10 THE RIVERSIDE PIAZZA',
  address_type: 'bo_ShipTo',
};
const sapShipSuffix = {
  site_id: '#04-10 THE RIVERSIDE PIAZZA - 1',
  address_type: 'bo_ShipTo',
};
assert.equal(findExistingLocationRow([portalShipBase], sapShipSuffix), portalShipBase);

// content+type match — portal deriveSiteId vs SAP AddressName (same street)
const portalDerivedBill = {
  id: 'loc-bill-derived',
  site_id: '123#01',
  address_type: 'bo_BillTo',
  street: '1 HILLTOPS ROAD',
  building: '#01-01',
  address: '1 HILLTOPS ROAD, #01-01, Singapore',
  zip_code: '123456',
  city: 'SG',
};
const sapBillNamed = {
  site_id: 'HILLTOPS',
  address_type: 'bo_BillTo',
  street: '1 HILLTOPS ROAD',
  building: '#01-01',
  address: '1 HILLTOPS ROAD, #01-01, Singapore, 123456',
  zip_code: '123456',
  city: 'SG',
};
assert.equal(findExistingLocationRow([portalDerivedBill], sapBillNamed), portalDerivedBill);

// same site_id for bill+ship (no invented " - 1") still matches by type
const portalShipSameSite = {
  id: 'loc-ship-same',
  site_id: 'HILLTOPS',
  address_type: 'bo_ShipTo',
  street: '1 HILLTOPS ROAD',
  building: '#01-01',
  address: '1 HILLTOPS ROAD, #01-01, Singapore',
  zip_code: '123456',
  city: 'SG',
};
const sapShipNamed = {
  site_id: 'HILLTOPS',
  address_type: 'bo_ShipTo',
  street: '1 HILLTOPS ROAD',
  building: '#01-01',
  address: '1 HILLTOPS ROAD, #01-01, Singapore, 123456',
  zip_code: '123456',
  city: 'SG',
};
assert.equal(findExistingLocationRow([portalShipSameSite], sapShipNamed), portalShipSameSite);
assert.equal(
  findExistingLocationRow([portalDerivedBill, portalShipSameSite], sapBillNamed),
  portalDerivedBill
);

// masterlist zip-tail site_id matches SAP AddressName (no second insert)
const portalZipTailBill = {
  id: 'loc-zip-tail',
  site_id: 'A2 (SERVER ROOM), 403032',
  address_type: 'bo_BillTo',
  street: '202 BEDOK SOUTH AVE 1',
  building: 'A2 (SERVER ROOM)',
  address: '202 BEDOK SOUTH AVE 1, A2 (SERVER ROOM), Singapore, 403032',
  zip_code: '403032',
  city: 'SG',
};
const sapServerRoomBill = {
  site_id: 'A2 (SERVER ROOM)',
  address_type: 'bo_BillTo',
  street: '202 BEDOK SOUTH AVE 1',
  building: 'A2 (SERVER ROOM)',
  address: '202 BEDOK SOUTH AVE 1, A2 (SERVER ROOM), Singapore, 403032',
  zip_code: '403032',
  city: 'SG',
};
assert.equal(findExistingLocationRow([portalZipTailBill], sapServerRoomBill), portalZipTailBill);

// middot postal tail also matches SAP AddressName
const portalMiddotTailBill = {
  id: 'loc-middot-tail',
  site_id: 'A2 (SERVER ROOM) · 403032',
  address_type: 'bo_BillTo',
  street: '202 BEDOK SOUTH AVE 1',
  building: 'A2 (SERVER ROOM)',
  zip_code: '403032',
};
assert.equal(findExistingLocationRow([portalMiddotTailBill], sapServerRoomBill), portalMiddotTailBill);

// unrelated nick with different content stays unmatched (ghost cleanup can remove when safe)
const portalUnrelatedNick = {
  id: 'loc-blr30',
  site_id: 'BLR 30 (HQ CONTRACT), 403032',
  address_type: 'bo_BillTo',
  street: '99 UNRELATED ROAD',
  building: 'BLR 30',
  address: '99 UNRELATED ROAD, BLR 30, Singapore, 403032',
  zip_code: '403032',
  city: 'SG',
};
const sapStreetOnlyBill = {
  site_id: '202 BEDOK SOUTH AVE 1',
  address_type: 'bo_BillTo',
  street: '202 BEDOK SOUTH AVE 1',
  building: null,
  address: '202 BEDOK SOUTH AVE 1, Singapore, 403032',
  zip_code: '403032',
  city: 'SG',
};
assert.equal(findExistingLocationRow([portalUnrelatedNick], sapStreetOnlyBill), null);

// preview — zip-tail twin shows update/unchanged (not add); unrelated portal-only shows remove
const zipTailPreviewExisting = [
  {
    id: 'zip-bill',
    site_id: 'A2 (SERVER ROOM), 403032',
    address_type: 'bo_BillTo',
    address: '202 BEDOK SOUTH AVE 1, A2 (SERVER ROOM), Singapore, 403032',
    street: '202 BEDOK SOUTH AVE 1',
    building: 'A2 (SERVER ROOM)',
    block: null,
    city: null,
    country_name: 'Singapore',
    zip_code: '403032',
  },
  {
    id: 'ghost-bill',
    site_id: 'BLR 30 (HQ CONTRACT), 403032',
    address_type: 'bo_BillTo',
    address: '99 UNRELATED ROAD, BLR 30, Singapore, 403032',
    street: '99 UNRELATED ROAD',
    building: 'BLR 30',
    block: null,
    city: null,
    country_name: 'Singapore',
    zip_code: '403032',
  },
];
const zipTailPreviewSap = [
  {
    AddressName: 'A2 (SERVER ROOM)',
    AddressType: 'bo_BillTo',
    Street: '202 BEDOK SOUTH AVE 1',
    Building: 'A2 (SERVER ROOM)',
    ZipCode: '403032',
    Country: 'SG',
  },
];
const zipTailPreviewChanges = computeAddressChangesForEntity(
  zipTailPreviewExisting,
  zipTailPreviewSap
);
const zipTailUpdate = zipTailPreviewChanges.find((c) =>
  String(c.label || '').includes('A2 (SERVER ROOM)')
);
assert.ok(zipTailUpdate);
assert.ok(zipTailUpdate.action === 'unchanged' || zipTailUpdate.action === 'update');
assert.notEqual(zipTailUpdate.action, 'add');
const ghostRemove = zipTailPreviewChanges.find((c) =>
  String(c.label || '').includes('BLR 30')
);
assert.ok(ghostRemove);
assert.equal(ghostRemove.action, 'remove');

// display fallback for truncated row shape
const truncatedUi = {
  AddressName: '#16-24 HILLION RESIDENCES',
  Street: '10 JELEBU ROAD',
  Building: '',
  BuildingFloorRoom: '',
  ZipCode: '677672',
  Country: 'SG',
  PortalFullAddress: '',
};
assert.equal(
  formatPortalBpAddressSubtitle(truncatedUi),
  '10 JELEBU ROAD, #16-24 HILLION RESIDENCES, Singapore, 677672'
);

// preview — add / update / remove / unchanged
const previewExisting = [
  {
    id: 'bill-1',
    site_id: 'BILL-MAIN',
    address_type: 'bo_BillTo',
    address: '1 BILL STREET, Singapore',
    street: '1 BILL STREET',
    building: null,
    block: null,
    city: null,
    country_name: 'Singapore',
    zip_code: null,
  },
  {
    id: 'ship-old',
    site_id: 'OLD SHIP SITE',
    address_type: 'bo_ShipTo',
    address: '99 OLD ROAD, Singapore',
    street: '99 OLD ROAD',
    building: null,
    block: null,
    city: null,
    country_name: 'Singapore',
    zip_code: null,
  },
];
const previewSap = [
  {
    AddressName: 'BILL-MAIN',
    AddressType: 'bo_BillTo',
    Street: '1 BILL STREET',
    Country: 'SG',
  },
  {
    AddressName: 'NEW SHIP SITE',
    AddressType: 'bo_ShipTo',
    Street: '10 JELEBU ROAD',
    Building: '#16-24 HILLION RESIDENCES',
    ZipCode: '677672',
    Country: 'SG',
  },
];
const previewChanges = computeAddressChangesForEntity(previewExisting, previewSap);
assert.equal(previewChanges.length, 3);
const billChange = previewChanges.find((c) => c.label.startsWith('BILL-MAIN'));
assert.ok(billChange.action === 'unchanged' || billChange.action === 'update');
const shipAdd = previewChanges.find((c) => c.label.startsWith('NEW SHIP SITE'));
assert.equal(shipAdd.action, 'add');
assert.equal(shipAdd.before, null);
const shipRemove = previewChanges.find((c) => c.label.startsWith('OLD SHIP SITE'));
assert.equal(shipRemove.action, 'remove');
assert.equal(shipRemove.after, null);

// HTML ampersand entities in address parts (SAP/portal)
assert.equal(sanitizeAddressPart('POLLEN &amp; BLEU'), 'POLLEN & BLEU');
assert.equal(sanitizeAddressPart('POLLEN &AMP; BLEU'), 'POLLEN & BLEU');
assert.equal(sanitizeAddressPart('POLLEN &#38; BLEU'), 'POLLEN & BLEU');
assert.equal(sanitizeAddressPart('POLLEN &#x26; BLEU'), 'POLLEN & BLEU');

// Objects must never stringify to "[object Object]" (jobsheet PDF regression)
assert.equal(sanitizeAddressPart({ street: '1 THE KNOLLS' }), '');
assert.equal(sanitizeAddressPart(['1 THE KNOLLS']), '');
assert.equal(sanitizeAddressPart('[object Object]'), '');
assert.equal(sanitizeAddressPart(42), '42');
assert.equal(sanitizeAddressPart(true), '');

const { formatLocationRecordAsSingleLine } = await import('../lib/jobs/resolveJobDisplayAddress.js');
assert.equal(
  formatLocationRecordAsSingleLine({
    address: { streetNo: { n: 1 }, streetAddress: '1 THE KNOLLS', city: 'SENTOSA ISLAND', country: 'Singapore', postalCode: '098297' },
  }),
  '1 THE KNOLLS, SENTOSA ISLAND, Singapore, 098297'
);
assert.equal(
  formatLocationRecordAsSingleLine({
    street: '1 THE KNOLLS',
    building: { name: 'Capella' },
    city: 'SENTOSA ISLAND',
    country: 'SG',
    zip_code: '098297',
  }),
  '1 THE KNOLLS, SENTOSA ISLAND, Singapore, 098297'
);
assert.equal(
  formatLocationRecordAsSingleLine({
    street: {},
    address: { Street: '1 THE KNOLLS', City: 'SENTOSA ISLAND', Country: 'SG', ZipCode: '098297' },
  }),
  '1 THE KNOLLS, SENTOSA ISLAND, Singapore, 098297'
);
assert.equal(
  formatLocationRecordAsSingleLine({
    street: {},
    address: '1 THE KNOLLS',
    city: 'SENTOSA ISLAND',
    country: 'SG',
    zip_code: '098297',
  }),
  '1 THE KNOLLS, SENTOSA ISLAND, Singapore, 098297'
);
assert.equal(
  formatLocationRecordAsSingleLine({
    address: { Street: '1 THE KNOLLS', City: 'SENTOSA ISLAND', Country: 'SG', ZipCode: '098297' },
    city: 'SENTOSA ISLAND',
    country: 'SG',
    zip_code: '098297',
  }),
  '1 THE KNOLLS, SENTOSA ISLAND, Singapore, 098297'
);

// Duplicate-address regressions: composed building/block must not append a second full line
const CAPELLA_LINE = '1 THE KNOLLS, SENTOSA ISLAND, Singapore, 098297';
assert.equal(
  formatLocationRecordAsSingleLine({
    street: CAPELLA_LINE,
    building: CAPELLA_LINE,
  }),
  CAPELLA_LINE
);
assert.equal(
  formatLocationRecordAsSingleLine({
    street: CAPELLA_LINE,
    block: CAPELLA_LINE,
  }),
  CAPELLA_LINE
);
// Capella-like: short street + richer portal address + city/country/zip → one line
assert.equal(
  formatLocationRecordAsSingleLine({
    street: '1 THE KNOLLS',
    address: CAPELLA_LINE,
    city: 'SENTOSA ISLAND',
    country: 'Singapore',
    zip_code: '098297',
  }),
  CAPELLA_LINE
);

console.log('sapAddressSync tests passed');

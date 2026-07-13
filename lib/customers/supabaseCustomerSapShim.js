import { sanitizeAddressPart, portalFullAddressFromDbRow } from '../utils/formatPortalBpAddress.js';

/**
 * Map Supabase customer + nested customer_location rows to the SAP-shaped objects
 * expected by the customers list table and AccountInfoTab / ServiceLocationTab.
 */

/** Global search — flat fields only, no nested joins. */
export const SUPABASE_CUSTOMER_LIST_SEARCH_SELECT =
  'customer_code, customer_name, phone_number, email, customer_address';

/** Grid / masterlist API — flat columns only (no nested customer_location). */
export const SUPABASE_CUSTOMER_LIST_FLAT_SELECT = `
  id,
  customer_code,
  customer_name,
  phone_number,
  email,
  customer_address,
  bill_to_default,
  ship_to_default
`;

/** Slim customer_location columns for list-page batch enrichment (not nested on customer). */
export const SUPABASE_CUSTOMER_LOCATION_LIST_SUMMARY_SELECT =
  'customer_id, site_id, building, street, address, city, country_name, zip_code, address_type';

/** Alias for list/summary APIs — same as FLAT (locations load on detail/bundle only). */
export const SUPABASE_CUSTOMER_LIST_SELECT = SUPABASE_CUSTOMER_LIST_FLAT_SELECT;

/** PostgREST select for detail tabs (keep in sync with RLS and import script). */
export const SUPABASE_CUSTOMER_WITH_LOCATIONS_SELECT = `
  id,
  customer_code,
  customer_name,
  phone_number,
  email,
  customer_address,
  sap_card_code,
  bill_to_default,
  ship_to_default,
  contacts (
    id,
    first_name,
    middle_name,
    last_name,
    tel1,
    tel2,
    email,
    customer_location_id
  ),
  customer_location (
    id,
    site_id,
    building,
    street_number,
    street,
    block,
    address,
    city,
    country_name,
    zip_code,
    address_type,
    location_id,
    locations (
      id,
      location_name,
      street,
      address
    ),
    contacts (
      id,
      first_name,
      middle_name,
      last_name,
      tel1,
      tel2,
      email
    )
  )
`;

/** UI rows for per-site contacts (sorted by id = primary first). */
function portalSiteContactsFromDbRows(siteRows) {
  if (!Array.isArray(siteRows) || siteRows.length === 0) return [];
  return [...siteRows]
    .filter((c) => c && c.id)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((c) => {
      const first = (c.first_name || '').trim();
      const mid = (c.middle_name || '').trim();
      const last = (c.last_name || '').trim();
      const display = [first, mid, last].filter(Boolean).join(' ').trim();
      return {
        id: c.id,
        contactPerson: display || first || last || '',
        contactPhone: ((c.tel1 || c.tel2) || '').toString().trim(),
        contactEmail: (c.email || '').trim(),
      };
    });
}

/** SAP ContactEmployees-shaped object for ServiceLocationTab / AccountInfoTab. */
function sapContactFromDbRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const c = rows[0];
  const first = (c.first_name || '').trim();
  const mid = (c.middle_name || '').trim();
  const last = (c.last_name || '').trim();
  const display = [first, mid, last].filter(Boolean).join(' ').trim();
  const phone = (c.tel1 || c.tel2 || '').toString().trim();
  return {
    Name: display || first || last || '—',
    FirstName: first,
    LastName: last || mid,
    Phone1: phone,
    Active: 'tYES',
    E_Mail: c.email || '',
  };
}

function mapLocationToAllAddress(cl) {
  const site = cl.site_id || '';
  const building = sanitizeAddressPart(cl.building);
  const street = sanitizeAddressPart(cl.street);
  const zip = cl.zip_code || '';
  const country = cl.country_name || '';
  return {
    Address1: building || site || '',
    Address2: cl.address || '',
    Address3: '',
    Street: street,
    Building: building,
    BuildingFloorRoom: building,
    PostalCode: zip,
    ZipCode: zip,
    Country: country,
    CountryName: country,
    AddressName: site,
    SiteID: site,
  };
}

function partKey(value) {
  return sanitizeAddressPart(value).toLowerCase().replace(/\s+/g, ' ');
}

/** Block/unit-only tokens (e.g. 3-#14-06, #14-06) are not a street line. */
function isBlockUnitOnly(value) {
  const s = sanitizeAddressPart(value);
  if (!s) return true;
  const compact = s.replace(/\s/g, '');
  if (/^#?\d{2}-\d{2}$/.test(compact)) return true;
  if (/^\d+-?#?\d{2}-\d{2}$/.test(compact)) return true;
  if (/^\d+#\d{2}-\d{2}$/.test(compact)) return true;
  return false;
}

function isWeakStreetOrDuplicate(street, siteId, building) {
  const s = sanitizeAddressPart(street);
  if (!s) return true;
  if (isBlockUnitOnly(s)) return true;
  const site = partKey(siteId);
  const bld = partKey(building);
  const sk = partKey(s);
  if (site && sk === site) return true;
  if (bld && sk === bld) return true;
  return false;
}

function linkedLocationRecord(cl) {
  const loc = cl?.locations;
  if (!loc) return null;
  return Array.isArray(loc) ? loc[0] : loc;
}

export function buildSharedLocationIdSet(locs) {
  const counts = new Map();
  for (const cl of locs || []) {
    const locationId = cl?.location_id;
    if (!locationId) continue;
    counts.set(locationId, (counts.get(locationId) || 0) + 1);
  }
  const shared = new Set();
  for (const [locationId, count] of counts) {
    if (count > 1) shared.add(locationId);
  }
  return shared;
}

/** Prefer linked job `locations.location_name` when customer_location street is block/unit only. */
export function resolveCustomerLocationStreet(cl, { sharedLocationIds } = {}) {
  if (!cl || typeof cl !== 'object') return '';

  const siteId = cl.site_id || '';
  const building = cl.building || '';
  const direct = sanitizeAddressPart(cl.street);
  const fromAddress = sanitizeAddressPart(cl.address);

  if (direct && !isWeakStreetOrDuplicate(direct, siteId, building)) return direct;
  if (
    fromAddress &&
    !isWeakStreetOrDuplicate(fromAddress, siteId, building) &&
    fromAddress.includes(' ')
  ) {
    return fromAddress;
  }

  const linked = linkedLocationRecord(cl);
  const locStreet = sanitizeAddressPart(linked?.street || linked?.address);
  if (locStreet && !isWeakStreetOrDuplicate(locStreet, siteId, building)) return locStreet;

  let locName = sanitizeAddressPart(linked?.location_name);
  if (locName) {
    const siteSuffix = sanitizeAddressPart(siteId);
    const altSuffix = siteSuffix.includes('#') ? siteSuffix.replace('#', '-#') : siteSuffix;
    for (const suffix of [altSuffix, siteSuffix].filter(Boolean)) {
      if (locName.endsWith(suffix)) {
        locName = locName.slice(0, -suffix.length).replace(/,\s*$/, '').trim();
        break;
      }
      const withComma = `, ${suffix}`;
      if (locName.endsWith(withComma)) {
        locName = locName.slice(0, -withComma.length).trim();
        break;
      }
    }
    if (locName && !isWeakStreetOrDuplicate(locName, siteId, building)) {
      return locName;
    }
  }

  return direct || fromAddress || '';
}

/** Short site label (e.g. 3#14-06) for portal rows synced from Google leads. */
function portalLocationShortLabel(cl) {
  const site = (cl.site_id || '').trim();
  if (site) return site;
  const block = (cl.block || '').trim();
  const building = (cl.building || '').trim();
  if (block && building) return `${block}${building.startsWith('#') ? building : `#${building}`}`;
  return building || '';
}

function isBillAddressType(addressType) {
  const t = (addressType || '').toString().trim().toUpperCase();
  return t === 'B' || t === 'BO_BILLTO' || t === 'BILLTO';
}

function isShipAddressType(addressType) {
  const t = (addressType || '').toString().trim().toUpperCase();
  return t === 'S' || t === 'BO_SHIPTO' || t === 'SHIPTO';
}

export function mapLocationToBPAddress(cl, customerLevelContactRows = [], sharedLocationIds = null) {
  const t = (cl.address_type || '').toString().trim().toUpperCase();
  let addressType = '';
  if (t === 'B' || t === 'BO_BILLTO' || t === 'BILLTO') addressType = 'bo_BillTo';
  else if (t === 'S' || t === 'BO_SHIPTO' || t === 'SHIPTO') addressType = 'bo_ShipTo';
  else if (t) addressType = t;

  const siteLabel = portalLocationShortLabel(cl);

  const siteContacts = Array.isArray(cl.contacts) ? cl.contacts : [];
  const pool =
    siteContacts.length > 0 ? siteContacts : (customerLevelContactRows || []);
  const LocationContact = sapContactFromDbRows(pool);
  const atSiteCount = siteContacts.length;

  const portalFull = portalFullAddressFromDbRow(cl);

  const row = {
    /** Supabase `customer_location.id` — used for per-site contact PATCH. */
    PortalLocationId: cl.id || null,
    /** Count of contacts stored on this site (not inherited customer-level fallbacks). */
    PortalContactCount: atSiteCount,
    /** Editable site-scoped contacts for ServiceLocationTab (empty if none in DB). */
    PortalSiteContacts: portalSiteContactsFromDbRows(siteContacts),
    /** Portal-edited full address line (customer_location.address). */
    PortalFullAddress: portalFull,
    AddressName: siteLabel,
    SiteID: siteLabel,
    Street: portalFull
      ? ''
      : resolveCustomerLocationStreet(cl, { sharedLocationIds }),
    Building: portalFull ? '' : sanitizeAddressPart(cl.building),
    BuildingFloorRoom: portalFull ? '' : sanitizeAddressPart(cl.building),
    ZipCode: cl.zip_code || '',
    City: cl.city || '',
    Country: 'SG',
    CountryName: cl.country_name || '',
    AddressType: addressType,
    Default: 'N',
    LocationContact,
  };
  if (LocationContact) {
    row.Name = LocationContact.Name;
    row.Phone1 = LocationContact.Phone1;
  }
  return row;
}

/**
 * Row shape for customers list (matches SAP merge output).
 */
export function listRowFromSupabaseCustomer(c) {
  const locs = Array.isArray(c.customer_location) ? c.customer_location : [];
  const allCustContacts = Array.isArray(c.contacts) ? c.contacts : [];
  const customerLevelContacts = allCustContacts.filter((x) => !x.customer_location_id);
  const AllAddresses = locs.map(mapLocationToAllAddress);
  const locationCount = locs.length;

  if (AllAddresses.length === 0 && c.customer_address) {
    AllAddresses.push({
      Address1: '',
      Street: c.customer_address,
      Building: '',
      PostalCode: '',
      Country: '',
    });
  }

  return {
    CardCode: c.customer_code || '',
    CardName: c.customer_name || '',
    Phone1: c.phone_number || '',
    EmailAddress: c.email || '',
    AllAddresses,
    locationCount,
    MailAddress: c.customer_address || '',
    Street: c.customer_address || '',
    Address: c.customer_address || '',
    BilltoDefault: sanitizeAddressPart(c.bill_to_default) || '',
    ShiptoDefault: sanitizeAddressPart(c.ship_to_default) || '',
    ZipCode: '',
    City: '',
    Country: '',
    BPAddresses: locs.map((cl) => mapLocationToBPAddress(cl, customerLevelContacts)),
  };
}

/**
 * Full BusinessPartner-like object for customer detail tabs.
 */
export function sapPartnerFromSupabaseCustomerBundle(c) {
  const locs = Array.isArray(c.customer_location) ? c.customer_location : [];
  const sharedLocationIds = buildSharedLocationIdSet(locs);
  const allCustContacts = Array.isArray(c.contacts) ? c.contacts : [];
  const customerLevelContacts = allCustContacts.filter((x) => !x.customer_location_id);
  const BPAddresses = locs.map((cl) =>
    mapLocationToBPAddress(cl, customerLevelContacts, sharedLocationIds)
  );

  let primaryEmployeeContact = sapContactFromDbRows(customerLevelContacts);
  if (!primaryEmployeeContact) {
    for (const cl of locs) {
      const siteRows = Array.isArray(cl.contacts) ? cl.contacts : [];
      const sc = sapContactFromDbRows(siteRows);
      if (sc) {
        primaryEmployeeContact = sc;
        break;
      }
    }
  }

  const billDefaultName = sanitizeAddressPart(c.bill_to_default) || '';
  const shipDefaultName = sanitizeAddressPart(c.ship_to_default) || '';

  // Only treat DB defaults as Default when they match an existing location of the
  // correct type. Do not invent a Default badge from the first bill/ship row.
  const matchedBillDefault = billDefaultName
    ? BPAddresses.find(
        (a) => a.AddressName === billDefaultName && isBillAddressType(a.AddressType)
      )
    : null;
  const matchedShipDefault = shipDefaultName
    ? BPAddresses.find(
        (a) => a.AddressName === shipDefaultName && isShipAddressType(a.AddressType)
      )
    : null;

  const bill =
    matchedBillDefault || BPAddresses.find((a) => isBillAddressType(a.AddressType));
  const ship =
    matchedShipDefault || BPAddresses.find((a) => isShipAddressType(a.AddressType));
  const first = BPAddresses[0];

  const resolvedHeaderStreet =
    sanitizeAddressPart(bill?.Street) ||
    sanitizeAddressPart(first?.Street) ||
    sanitizeAddressPart(c.customer_address) ||
    '';

  return {
    CardCode: c.customer_code,
    CardName: c.customer_name,
    Phone1: c.phone_number || '',
    EmailAddress: c.email || '',
    BPAddresses,
    ...(primaryEmployeeContact
      ? {
          ContactEmployees: [primaryEmployeeContact],
        }
      : {}),
    BilltoDefault: matchedBillDefault ? billDefaultName : '',
    ShiptoDefault: matchedShipDefault ? shipDefaultName : '',
    Street: resolvedHeaderStreet,
    Address: resolvedHeaderStreet,
    MailAddress: resolvedHeaderStreet || sanitizeAddressPart(c.customer_address) || '',
    ZipCode: first?.ZipCode || '',
    City: first?.City || '',
    Country: 'SG',
    Building: first?.Building || '',
    BillToBuildingFloorRoom: first?.BuildingFloorRoom || '',
  };
}

/** SAP sql08-shaped row from public.equipments (Create Job / customer tabs). */
export function sapEquipmentFromDbRow(row) {
  if (!row) return null;
  return {
    ItemCode: row.item_code || '',
    ItemName: row.item_name || '',
    ItemGroup: row.item_group || '',
    Brand: row.brand || '',
    ModelSeries: row.model_series || '',
    SerialNo: row.serial_number || '',
    EquipmentLocation: row.equipment_location || '',
    EquipmentType: row.equipment_type || '',
    Notes: row.notes || '',
    WarrantyStartDate: row.warranty_start_date || '',
    WarrantyEndDate: row.warranty_end_date || '',
    PortalEquipmentId: row.id || null,
  };
}

/** SAP sql08-shaped row from AIFM /customers/equipments. */
export function sapEquipmentFromAifmRow(row, index = 0) {
  if (!row) return null;
  const serial = String(row.serial_number || '').trim();
  const type = String(row.equipment_type || '').trim();
  const sku = String(row.sku || '').trim();
  const model = String(row.model || '').trim();
  const itemCode = sku || (row.id != null ? `AIFM-${row.id}` : `EQ-${index + 1}`);
  const itemName = [type, model, serial].filter(Boolean).join(' - ') || itemCode;
  const installDt = row.installation_dt && row.installation_dt !== '0000-00-00'
    ? row.installation_dt
    : '';
  const warrantyEnd = row.extended_warranty_exp || row.warranty_exp || '';

  return {
    ItemCode: itemCode,
    ItemName: itemName,
    ItemGroup: type || 'Equipment',
    Brand: '',
    ModelSeries: model,
    SerialNo: serial,
    EquipmentLocation: String(row.location || '').trim(),
    EquipmentType: type,
    Notes: String(row.notes || '').trim(),
    WarrantyStartDate: installDt,
    WarrantyEndDate: warrantyEnd,
    AifmEquipmentId: row.id ?? null,
  };
}

import { sanitizeAddressPart } from '../utils/formatPortalBpAddress.js';
import { siteAddressLookupKeys } from '../utils/siteAddressKeyAliases.js';

export const SHIP_MINUS_ONE_SUFFIX = ' - 1';

const BILL_SHIP_ADDRESS_TYPES = new Set(['bo_BillTo', 'bo_ShipTo']);

function addressFieldKey(value) {
  return sanitizeAddressPart(value).toLowerCase().replace(/\s+/g, ' ');
}

function normalizePortalAddressType(raw) {
  const t = String(raw || '').trim().toUpperCase();
  if (t === 'B' || t === 'BO_BILLTO' || t === 'BILLTO') return 'bo_BillTo';
  if (t === 'S' || t === 'BO_SHIPTO' || t === 'SHIPTO') return 'bo_ShipTo';
  return sanitizeAddressPart(raw) || null;
}

/** Normalized address content for merge/dedupe (type-agnostic). */
export function normPortalAddressContent(row) {
  const parts = [row?.street, row?.building, row?.address, row?.zip_code, row?.city]
    .map((v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  return parts.join('|');
}

/** Stable core key: street + building + zip (ignores formatted address line drift). */
export function normPortalAddressCore(row) {
  const parts = [row?.street, row?.building, row?.zip_code]
    .map((v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean);
  return parts.join('|');
}

/** Group key: address_type + normalized content (ignores site_id drift). */
export function portalAddressTypeContentKey(row) {
  const type = normalizePortalAddressType(row?.address_type) || '';
  const content = normPortalAddressCore(row) || normPortalAddressContent(row);
  if (!type || !content) return '';
  return `${type}||${content}`;
}

export function stripShipMinusOneSuffix(siteId) {
  const s = String(siteId || '').trim();
  if (s.endsWith(SHIP_MINUS_ONE_SUFFIX)) {
    return s.slice(0, -SHIP_MINUS_ONE_SUFFIX.length);
  }
  return s;
}

/**
 * Prefer the row whose site_id matches SAP AddressName, else one with location_id, else first.
 * @param {object[]} group
 * @param {Set<string>|null} preferredSiteIds
 */
export function pickCanonicalLocationRow(group, preferredSiteIds = null) {
  if (!Array.isArray(group) || group.length === 0) return null;
  if (preferredSiteIds?.size) {
    const sapMatch = group.find((row) => preferredSiteIds.has(row.site_id));
    if (sapMatch) return sapMatch;
  }
  return group.find((row) => row.location_id) || group[0];
}

/**
 * Group bill/ship rows that share the same type + address content (duplicate stacks).
 * @returns {Map<string, object[]>}
 */
export function groupDuplicateBillShipByContent(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    const type = normalizePortalAddressType(row?.address_type);
    if (!BILL_SHIP_ADDRESS_TYPES.has(type)) continue;
    const key = portalAddressTypeContentKey(row);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return byKey;
}

/** Building/Floor/Room from SAP, or AddressName when SAP stores unit only on the site label. */
export function resolveSapBuildingLine(addr) {
  const street = sanitizeAddressPart(addr?.Street);
  const addressName = sanitizeAddressPart(addr?.AddressName);
  const fromSap = sanitizeAddressPart(addr?.Building || addr?.BuildingFloorRoom);
  if (fromSap) return fromSap;
  if (addressName && addressFieldKey(addressName) !== addressFieldKey(street)) {
    return addressName;
  }
  return '';
}

export function formatSapAddressLine(addr) {
  const countryRaw = addr?.Country === 'SG' ? 'Singapore' : (addr?.CountryName || addr?.Country || null);
  const countryName = sanitizeAddressPart(countryRaw) || null;
  const buildingLine = resolveSapBuildingLine(addr);
  const parts = [
    sanitizeAddressPart(addr?.Street),
    sanitizeAddressPart(addr?.Block),
    buildingLine,
    sanitizeAddressPart(addr?.City),
    countryName,
    sanitizeAddressPart(addr?.ZipCode),
  ].filter(Boolean);
  return parts.join(', ') || sanitizeAddressPart(addr?.AddressName) || null;
}

export function sapAddressToLocationRow(addr) {
  const siteId =
    sanitizeAddressPart(addr?.AddressName) ||
    sanitizeAddressPart(addr?.Street) ||
    'MAIN';
  const siteIdTrimmed = String(siteId).trim().slice(0, 100) || 'MAIN';
  const countryRaw = addr?.Country === 'SG' ? 'Singapore' : (addr?.CountryName || addr?.Country || null);
  const countryName = sanitizeAddressPart(countryRaw) || null;
  const street = sanitizeAddressPart(addr?.Street) || null;
  const building = resolveSapBuildingLine(addr) || null;
  const addressType = normalizePortalAddressType(addr?.AddressType);
  return {
    site_id: siteIdTrimmed,
    building,
    street,
    block: sanitizeAddressPart(addr?.Block) || null,
    city: sanitizeAddressPart(addr?.City) || null,
    country_name: countryName,
    zip_code: sanitizeAddressPart(addr?.ZipCode) || null,
    address_type: addressType,
    address: formatSapAddressLine(addr),
  };
}

const LOCATION_MERGE_FIELDS = [
  'street',
  'building',
  'block',
  'city',
  'country_name',
  'zip_code',
  'address_type',
  'address',
];

const LOCATION_TEXT_MERGE_FIELDS = new Set(['street', 'building', 'address']);

/** Keep portal text when SAP sends a shorter or substring-only value. */
export function shouldPreferExistingLocationField(existing, incoming) {
  const cur = sanitizeAddressPart(existing);
  const next = sanitizeAddressPart(incoming);
  if (!next) return true;
  if (!cur) return false;
  if (cur.length > next.length) return true;
  const curLower = cur.toLowerCase();
  const nextLower = next.toLowerCase();
  if (curLower.includes(nextLower) && cur.length > next.length) return true;
  return false;
}

/** Never let SAP delta sync wipe portal/backfilled address fields with empty or "-" placeholders. */
export function mergeCustomerLocationRow(existing, incoming) {
  const merged = { ...incoming };

  for (const field of LOCATION_MERGE_FIELDS) {
    const next = sanitizeAddressPart(incoming[field]);
    const cur = sanitizeAddressPart(existing?.[field]);
    if (!next && cur) {
      merged[field] = existing[field];
    } else if (
      next &&
      cur &&
      LOCATION_TEXT_MERGE_FIELDS.has(field) &&
      shouldPreferExistingLocationField(cur, next)
    ) {
      merged[field] = existing[field];
    } else if (next) {
      merged[field] = next;
    } else {
      merged[field] = null;
    }
  }

  if (!sanitizeAddressPart(merged.address)) {
    const recomposed = [merged.street, merged.building].map(sanitizeAddressPart).filter(Boolean).join(', ');
    merged.address = recomposed || existing?.address || null;
  }

  return merged;
}

/**
 * Match portal bill/ship rows to an incoming SAP/portal location row.
 * Order: exact site_id+type → ship ` - 1` alias → siteAddressLookupKeys intersection
 * (masterlist `, zip` / middot postal tails) → same type + normalized address content.
 */
export function findExistingLocationRow(existingRows, locationRow) {
  const addrType = normalizePortalAddressType(locationRow.address_type);
  const siteId = String(locationRow.site_id || '').trim();
  const rows = existingRows || [];

  let existing =
    rows.find(
      (row) =>
        row.site_id === siteId && normalizePortalAddressType(row.address_type) === addrType
    ) || null;
  if (existing) return existing;

  if (addrType === 'bo_ShipTo' || addrType === 'bo_BillTo') {
    const minusOneVariant = `${siteId}${SHIP_MINUS_ONE_SUFFIX}`;
    existing =
      rows.find(
        (row) =>
          row.site_id === minusOneVariant &&
          normalizePortalAddressType(row.address_type) === addrType
      ) || null;
    if (existing) return existing;

    if (siteId.endsWith(SHIP_MINUS_ONE_SUFFIX)) {
      const base = siteId.slice(0, -SHIP_MINUS_ONE_SUFFIX.length);
      existing =
        rows.find(
          (row) =>
            row.site_id === base && normalizePortalAddressType(row.address_type) === addrType
        ) || null;
      if (existing) return existing;
    }

    // Masterlist site_id (`A2 (SERVER ROOM), 403032`) vs SAP AddressName (`A2 (SERVER ROOM)`).
    const incomingKeys = new Set(siteAddressLookupKeys(siteId, addrType));
    if (incomingKeys.size) {
      existing =
        rows.find((row) => {
          if (normalizePortalAddressType(row.address_type) !== addrType) return false;
          const rowKeys = siteAddressLookupKeys(row.site_id, row.address_type);
          return rowKeys.some((k) => incomingKeys.has(k));
        }) || null;
      if (existing) return existing;
    }

    // Portal deriveSiteId vs SAP AddressName: merge when type + content match.
    const incomingContent = normPortalAddressContent(locationRow);
    const incomingCore = normPortalAddressCore(locationRow);
    if (incomingContent || incomingCore) {
      const incomingStreet = addressFieldKey(locationRow.street);
      existing =
        rows.find((row) => {
          if (normalizePortalAddressType(row.address_type) !== addrType) return false;
          const rowCore = normPortalAddressCore(row);
          if (incomingCore && rowCore && incomingCore === rowCore) return true;
          const rowContent = normPortalAddressContent(row);
          if (incomingContent && rowContent && rowContent === incomingContent) return true;
          // Require shared street before accepting substring overlap (avoids weak matches).
          const rowStreet = addressFieldKey(row.street);
          if (!incomingStreet || !rowStreet || incomingStreet !== rowStreet) return false;
          if (!incomingContent || !rowContent) return false;
          return (
            rowContent.includes(incomingContent) ||
            incomingContent.includes(rowContent)
          );
        }) || null;
      if (existing) return existing;
    }
  }

  return existing;
}

export function portalLocationCompositeKey(row) {
  const type = normalizePortalAddressType(row.address_type) || '';
  return `${String(row.site_id || '').trim()}||${type}`;
}

export function sapAddressCompositeKeys(bpAddresses) {
  const keys = new Set();
  for (const addr of bpAddresses || []) {
    const row = sapAddressToLocationRow(addr);
    if (!row.site_id) continue;
    const type = normalizePortalAddressType(row.address_type) || '';
    keys.add(`${row.site_id}||${type}`);
  }
  return keys;
}

export { normalizePortalAddressType, BILL_SHIP_ADDRESS_TYPES };

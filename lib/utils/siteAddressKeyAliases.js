/**
 * Normalize site / address-name strings used across Excel imports, SQL fixes, and UI (AddressName).
 * Must stay aligned with scripts/aifmCustomerLocationLookup.js `siteKeyVariants` so imports and the portal
 * resolve the same row for `customer_address_details`.
 */

/** Strip trailing postal tails: middot (` · 403032`) and comma (` , 403032`). */
function stripTrailingPostalFromSiteKey(siteId) {
  return String(siteId ?? '')
    .trim()
    .replace(/ · \d+$/, '')
    .replace(/, \d+$/, '');
}

/**
 * Same rules as scripts/aifmCustomerLocationLookup.js `commaSapSeparatorStyle` —
 * middot tails + stray trailing ship/bill marker.
 */
export function commaSapSeparatorStyle(siteId) {
  let s = String(siteId ?? '').trim();
  if (!s) return '';
  s = s.replace(/ · S · /gi, ', ').replace(/ · B · /gi, ', ');
  s = s.replace(/ · S$/i, '').replace(/ · B$/i, '');
  return s;
}

function uniqTrimmedStrings(list) {
  const out = [];
  const seen = new Set();
  for (const x of list) {
    const t = String(x ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function normalizeAddressTypeKey(addressType) {
  const t = String(addressType ?? '')
    .trim()
    .toUpperCase();
  if (t === 'B' || t === 'BO_BILLTO' || t === 'BILLTO') return 'B';
  if (t === 'S' || t === 'BO_SHIPTO' || t === 'SHIPTO') return 'S';
  return t;
}

const SHIP_BILL_MINUS_ONE_SUFFIX = ' - 1';

/**
 * Bill/ship site_id pairs: SAP lead conversion uses ship at `{siteId} - 1` while notes may use bare site + `|S`.
 */
function shipBillSiteIdPairVariants(siteId) {
  const s = String(siteId ?? '').trim();
  if (!s) return [];
  const variants = [s];
  if (s.endsWith(SHIP_BILL_MINUS_ONE_SUFFIX)) {
    variants.push(s.slice(0, -SHIP_BILL_MINUS_ONE_SUFFIX.length));
  } else {
    variants.push(`${s}${SHIP_BILL_MINUS_ONE_SUFFIX}`);
  }
  return variants;
}

/**
 * Canonical `customer_address_details.address_name` — bill-to: bare siteId; ship-to: `${siteId}|S`.
 * Ported from scripts/aifmCustomerLocationLookup.js.
 */
export function addressDetailsStorageName(siteId, addressType) {
  const base = String(siteId ?? '').trim();
  if (!base) return '';
  if (normalizeAddressTypeKey(addressType) === 'S') return `${base}|S`;
  return base;
}

/**
 * Candidate map keys for one site_id / AddressName — same variants as importer `siteKeyVariants`.
 * Ship-to rows also try `site_id|S` (see `addressDetailsStorageName` in aifmCustomerLocationLookup.js).
 */
export function siteAddressLookupKeys(siteId, addressType = '') {
  const s = String(siteId ?? '').trim();
  if (!s) return [];
  const typeKey = normalizeAddressTypeKey(addressType);
  const baseVariants = uniqTrimmedStrings(
    shipBillSiteIdPairVariants(s).flatMap((variant) => {
      const stripped = stripTrailingPostalFromSiteKey(variant);
      const commaS = commaSapSeparatorStyle(variant);
      const commaStripped = stripTrailingPostalFromSiteKey(commaS);
      return [variant, stripped, commaS, commaStripped];
    })
  );
  const keys = [...baseVariants];
  if (typeKey === 'S') {
    for (const k of baseVariants) {
      if (k) keys.push(`${k}|S`);
    }
  }
  return uniqTrimmedStrings(keys);
}

/**
 * Resolve `customer_address_details` row for a service-location row from Supabase shim / BPAddresses.
 * Prefer FK (`PortalLocationId`) when importer linked `customer_location_id`.
 */
export function resolveCustomerAddressDetailRow(addressDetailsMap, detailsByCustomerLocationId, location) {
  const locId = location?.PortalLocationId || location?.customer_location_id || location?.id;
  if (locId && detailsByCustomerLocationId && detailsByCustomerLocationId[locId]) {
    return detailsByCustomerLocationId[locId];
  }

  const addressType = location?.AddressType || location?.address_type;
  const nameCandidates = [
    location?.AddressName,
    location?.site_id,
    location?.SiteID,
    location?.PortalFullAddress,
    location?.Street,
    location?.BuildingFloorRoom,
  ];

  for (const name of nameCandidates) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) continue;
    for (const key of siteAddressLookupKeys(trimmed, addressType)) {
      if (key && addressDetailsMap[key]) return addressDetailsMap[key];
    }
  }
  return null;
}

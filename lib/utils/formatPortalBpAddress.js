/**
 * Format SAP-shaped BPAddresses for portal UI (Service Locations, Account Info).
 * Dedupes site label vs street/building and repeated zip segments.
 */

/** Placeholder tokens SAP/leads use when street is unknown — must not overwrite or display. */
const ADDRESS_PLACEHOLDER_RE = /^[-–—]+$/;
const ADDRESS_NULLISH_RE = /^(n\/a|na|nil|none|null|tbd)$/i;

/**
 * Decode common HTML ampersand entities left in SAP/portal strings.
 * Exported for customer names and other plain-text display fields that
 * must not show literal `&amp;` (addresses also go through sanitizeAddressPart).
 */
export function decodePortalHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&#x26;/gi, '&');
}

/** @param {unknown} value */
export function sanitizeAddressPart(value) {
  // Never coerce objects/arrays — String({}) === "[object Object]" and leaks into PDFs/UI.
  if (value == null) return '';
  if (typeof value === 'object') return '';
  if (typeof value === 'boolean') return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';

  const s = decodePortalHtmlEntities(String(value).trim());
  if (!s) return '';
  if (s === '[object Object]') return '';
  if (ADDRESS_PLACEHOLDER_RE.test(s)) return '';
  if (ADDRESS_NULLISH_RE.test(s)) return '';
  return s;
}

function normalizePart(value) {
  return sanitizeAddressPart(value);
}

function partKey(value) {
  return normalizePart(value).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Portal Full Address edits are stored on `customer_location.address` / `sap_lead_location.address`.
 * When that line differs from SAP `street` (+ `building`), treat it as the display override.
 * @param {Record<string, unknown>} row
 */
export function portalFullAddressFromDbRow(row) {
  const addr = sanitizeAddressPart(row?.address);
  if (!addr) return '';
  const street = sanitizeAddressPart(row?.street);
  if (!street) return addr;
  const building = sanitizeAddressPart(row?.building);
  const sapComposite = dedupeAddressParts([street, building]).join(', ');
  const addrKey = partKey(addr);
  if (addrKey === partKey(sapComposite) || addrKey === partKey(street)) return '';
  return addr;
}

/** @param {string[]} parts */
export function dedupeAddressParts(parts) {
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    const p = normalizePart(raw);
    if (!p) continue;
    const key = partKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function displayCountry(address) {
  const c = address?.Country;
  if (c === 'SG') return 'Singapore';
  return normalizePart(c || address?.CountryName);
}

/**
 * Core parts for one BP address row (optional site title).
 * @param {Record<string, unknown>} address
 * @param {{ includeSiteLabel?: boolean }} [opts]
 */
export function portalBpAddressParts(address, opts = {}) {
  if (!address || typeof address !== 'object') return [];

  const includeSiteLabel = opts.includeSiteLabel === true;
  const siteLabel = normalizePart(address.AddressName || address.SiteID);
  const portalLine = normalizePart(address.PortalFullAddress);
  if (portalLine) {
    const raw = [];
    if (includeSiteLabel && siteLabel) raw.push(siteLabel);
    raw.push(portalLine);
    return dedupeAddressParts(raw);
  }
  const street = normalizePart(address.Street);
  let building = normalizePart(address.BuildingFloorRoom || address.Building);
  const bareBuilding = normalizePart(address.Building);

  if (building && siteLabel && partKey(building) === partKey(siteLabel)) {
    building = bareBuilding && partKey(bareBuilding) !== partKey(siteLabel) ? bareBuilding : '';
  }

  // Subtitle: include unit/site line when street omits it (legacy truncated rows after SAP sync).
  if (!includeSiteLabel && !building && siteLabel && street) {
    const streetKey = partKey(street);
    const labelKey = partKey(siteLabel);
    if (labelKey && !streetKey.includes(labelKey)) {
      building = siteLabel;
    }
  }

  const country = displayCountry(address);
  const zip = normalizePart(address.ZipCode);
  const block = normalizePart(address.Block);
  const city = normalizePart(address.City);

  const storedAddress = normalizePart(address.address || address.Address);
  if (storedAddress) {
    const composite = dedupeAddressParts([street, building, block, city, country, zip]).join(', ');
    const compositeKey = partKey(composite);
    const storedKey = partKey(storedAddress);
    if (storedKey.length > compositeKey.length && !compositeKey.includes(storedKey)) {
      const raw = [];
      if (includeSiteLabel && siteLabel) raw.push(siteLabel);
      raw.push(storedAddress);
      return dedupeAddressParts(raw);
    }
  }

  const raw = [];
  if (includeSiteLabel && siteLabel) raw.push(siteLabel);
  if (street) raw.push(street);
  if (building) raw.push(building);
  if (block) raw.push(block);
  if (city) raw.push(city);
  if (country) raw.push(country);
  if (zip) raw.push(zip);

  return dedupeAddressParts(raw);
}

/** Subtitle under Address Name on Service Locations (no site title). */
export function formatPortalBpAddressSubtitle(address) {
  return portalBpAddressParts(address, { includeSiteLabel: false }).join(', ');
}

/** Single-line full address including site label once. */
export function formatPortalBpAddressFull(address) {
  return portalBpAddressParts(address, { includeSiteLabel: true }).join(', ');
}

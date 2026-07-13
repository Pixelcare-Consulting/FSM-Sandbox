import { extractTag } from '../integrations/aifmDescriptionTags.js';
import {
  dedupeAddressParts,
  portalFullAddressFromDbRow,
  sanitizeAddressPart,
} from '../utils/formatPortalBpAddress.js';

/** Split a composed address field into trimmed comma segments. */
function splitAddressField(value) {
  const s = sanitizeAddressPart(value);
  if (!s) return [];
  return s.split(',').map((part) => part.trim()).filter(Boolean);
}

/**
 * Flatten a nested address object (portal camelCase or SAP PascalCase) to one line.
 * @param {Record<string, unknown>} a
 */
function formatNestedAddressObject(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return '';

  const portalFull = sanitizeAddressPart(a.PortalFullAddress || a.portalFullAddress);
  if (portalFull) return portalFull;

  const countryRaw = sanitizeAddressPart(a.CountryName || a.country_name || a.country || a.Country);
  const country =
    String(countryRaw).toUpperCase() === 'SG' || String(countryRaw).toLowerCase() === 'singapore'
      ? 'Singapore'
      : countryRaw;

  return dedupeAddressParts([
    ...splitAddressField(a.streetNo || a.street_number || a.StreetNo),
    ...splitAddressField(a.streetAddress || a.street || a.Street),
    ...splitAddressField(a.block || a.Block),
    ...splitAddressField(a.buildingNo || a.building || a.Building || a.BuildingFloorRoom),
    ...splitAddressField(a.city || a.City),
    ...splitAddressField(a.stateProvince || a.state || a.State),
    ...splitAddressField(country),
    ...splitAddressField(a.postalCode || a.zip_code || a.ZipCode),
  ]).join(', ');
}

/**
 * One-line address from customer_location, locations row, or nested address object.
 */
export function formatLocationRecordAsSingleLine(loc) {
  if (!loc || typeof loc !== 'object') return '';

  const building = sanitizeAddressPart(loc.building);
  const block = sanitizeAddressPart(loc.block);
  const countryName = sanitizeAddressPart(loc.country_name || loc.country);
  const zipCode = sanitizeAddressPart(loc.zip_code);
  const city = sanitizeAddressPart(loc.city);
  const state = sanitizeAddressPart(loc.state || loc.state_province);

  // Only string street parts — object streets are handled via formatNestedAddressObject.
  const numberedStreet = [loc.street_number, loc.street]
    .map((p) => sanitizeAddressPart(p))
    .filter(Boolean)
    .join(' ');

  let streetAddress = '';
  const rawAddr = loc.street ?? loc.address ?? loc.location_name ?? loc.locationName;
  if (typeof rawAddr === 'string') {
    streetAddress = sanitizeAddressPart(rawAddr);
  } else if (rawAddr && typeof rawAddr === 'object') {
    streetAddress = formatNestedAddressObject(rawAddr);
  }

  if (!streetAddress && numberedStreet) {
    streetAddress = numberedStreet;
  }

  // street may be an empty/useless object while address/location_name holds the real line
  if (!streetAddress) {
    for (const fallback of [loc.address, loc.location_name, loc.locationName]) {
      if (!fallback || fallback === rawAddr) continue;
      if (typeof fallback === 'string') {
        streetAddress = sanitizeAddressPart(fallback);
      } else if (typeof fallback === 'object') {
        streetAddress = formatNestedAddressObject(fallback);
      }
      if (streetAddress) break;
    }
  }

  // Prefer richer portal `address` when street is only a short label / prefix of that line.
  const portalFull = portalFullAddressFromDbRow(loc);
  if (portalFull) {
    streetAddress = portalFull;
  }

  const formattedCountry =
    String(countryName).toUpperCase() === 'SG' || String(countryName).toLowerCase() === 'singapore'
      ? 'Singapore'
      : countryName || '';

  // Split every candidate field so composed building/block lines cannot append as duplicates.
  return dedupeAddressParts([
    ...splitAddressField(streetAddress),
    ...splitAddressField(building),
    ...splitAddressField(block),
    ...splitAddressField(city),
    ...splitAddressField(state),
    ...splitAddressField(formattedCountry),
    ...splitAddressField(zipCode),
  ]).join(', ');
}

/** Match customer_location row to a job's linked location. */
export function matchCustomerLocation(customerLocations, jobLocationId, jobLocationName) {
  if (!Array.isArray(customerLocations) || customerLocations.length === 0) return null;

  if (jobLocationId) {
    const byId = customerLocations.find((cl) => cl.location_id === jobLocationId);
    if (byId) return byId;
  }

  const locName = (jobLocationName || '').trim().toLowerCase();
  if (locName) {
    const byName = customerLocations.find((cl) => {
      const sid = String(cl.site_id || '').trim().toLowerCase();
      const bld = String(cl.building || '').trim().toLowerCase();
      return (sid && locName.includes(sid)) || (bld && locName.includes(bld));
    });
    if (byName) return byName;
  }

  return null;
}

/**
 * Resolve a display address for job list/history rows.
 * Priority: [ADDRESS:] tag → customer_location (full) → locations.location_name → job_schedule → customer_location fallback.
 */
export function resolveJobDisplayAddress(job, context = {}) {
  const description = job.description || job.jobDescription || '';
  const tagAddress = extractTag(description, 'ADDRESS');
  if (tagAddress) {
    return tagAddress.replace(/\s+/g, ' ').trim();
  }

  const locationName = (job.location?.location_name || job.location?.locationName || '').trim();
  const jobLocationId = job.location?.id || job.location_id;

  const matched = matchCustomerLocation(
    context.customerLocations,
    jobLocationId,
    locationName
  );
  if (matched) {
    const customerLine = formatLocationRecordAsSingleLine(matched);
    if (customerLine && (!locationName || customerLine.length > locationName.length)) {
      return customerLine;
    }
  }

  if (locationName) return locationName;

  const scheduleAddress = (context.scheduleAddress ?? job.scheduleAddress ?? '').trim();
  if (scheduleAddress) return scheduleAddress;

  if (matched) {
    return formatLocationRecordAsSingleLine(matched);
  }

  return '';
}

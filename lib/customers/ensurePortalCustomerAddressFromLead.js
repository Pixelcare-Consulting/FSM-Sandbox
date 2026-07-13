import {
  buildLeadLocationName,
  getCustomerAddressFromLead,
} from "../utils/leadLocationName.js";
import { sanitizeAddressPart } from "../utils/formatPortalBpAddress.js";
import { resolveCustomerLocationStreet } from "./supabaseCustomerSapShim.js";
import {
  findExistingLocationRow,
  normalizePortalAddressType,
  BILL_SHIP_ADDRESS_TYPES,
} from "../integrations/sapAddressLocationHelpers.js";

function deriveSiteId(lead) {
  const named =
    sanitizeAddressPart(lead?.bill_address_name) ||
    sanitizeAddressPart(lead?.ship_address_name) ||
    sanitizeAddressPart(lead?.address_name);
  if (named) return named.substring(0, 100);

  const block = String(lead?.block || "").trim();
  const unit = String(lead?.unit || "").trim();
  if (block && unit) {
    const u = unit.startsWith("#") ? unit : `#${unit}`;
    return `${block}${u}`.substring(0, 100);
  }
  const building = String(lead?.building || "").trim();
  if (building) return building.substring(0, 100);
  const addr = getCustomerAddressFromLead(lead);
  if (addr) return addr.substring(0, 100);
  return "Primary";
}

function normalizeCountry(country) {
  const c = String(country || "").trim();
  if (!c) return "Singapore";
  if (c.toUpperCase() === "SG") return "Singapore";
  return c;
}

function resolveLocationBuilding(lead, siteId) {
  const named = lead.building ? String(lead.building).trim() : "";
  if (named) return named;
  const unit = lead.unit ? String(lead.unit).trim() : "";
  if (unit) return unit;
  return siteId || null;
}

function buildLocationPayload(lead, customerId, customerAddress, addressType, siteId, locationId) {
  const street =
    sanitizeAddressPart(lead.street) ||
    (sanitizeAddressPart(customerAddress) ? String(customerAddress).substring(0, 255) : null);
  return {
    customer_id: customerId,
    site_id: siteId,
    building: resolveLocationBuilding(lead, siteId),
    street,
    block: lead.block ? String(lead.block).trim() : null,
    address: sanitizeAddressPart(customerAddress) || customerAddress,
    city: "SG",
    country_name: normalizeCountry(lead.country),
    zip_code: lead.postcode ? String(lead.postcode).trim() : null,
    address_type: addressType,
    ...(locationId ? { location_id: locationId } : {}),
  };
}

const LOCATION_MERGE_FIELDS = [
  'street',
  'building',
  'block',
  'address',
  'city',
  'country_name',
  'zip_code',
  'address_type',
  'location_id',
];

function mergePortalLocationPayload(existing, incoming) {
  const merged = { ...incoming };
  for (const field of LOCATION_MERGE_FIELDS) {
    const next = sanitizeAddressPart(incoming[field]);
    const cur = sanitizeAddressPart(existing?.[field]);
    if (!next && cur) {
      merged[field] = existing[field];
    } else if (next) {
      merged[field] = field === 'location_id' ? incoming[field] : next;
    }
  }
  if (!sanitizeAddressPart(merged.address)) {
    const recomposed = [merged.street, merged.building].map(sanitizeAddressPart).filter(Boolean).join(', ');
    merged.address = recomposed || existing?.address || null;
  }
  // Prefer stable SAP AddressName when updating a portal-derived site_id.
  if (sanitizeAddressPart(incoming.site_id)) {
    merged.site_id = incoming.site_id;
  }
  return merged;
}

async function loadCustomerLocations(supabase, customerId) {
  const { data: rows, error: fetchErr } = await supabase
    .from("customer_location")
    .select("id, site_id, address_type, street, building, block, address, city, country_name, zip_code, location_id")
    .eq("customer_id", customerId);

  if (fetchErr) {
    console.warn(
      "ensurePortalCustomerAddressFromLead: customer_location lookup failed:",
      fetchErr.message
    );
    return null;
  }
  return rows || [];
}

/**
 * True when portal already has bill+ship rows that look SAP-imported
 * (stable AddressName site_ids, not inventing a second ensure pass).
 */
function hasSapStyleBillShipPair(rows) {
  const billShip = (rows || []).filter((r) =>
    BILL_SHIP_ADDRESS_TYPES.has(normalizePortalAddressType(r.address_type))
  );
  if (billShip.length < 2) return false;
  const hasBill = billShip.some((r) => normalizePortalAddressType(r.address_type) === 'bo_BillTo');
  const hasShip = billShip.some((r) => normalizePortalAddressType(r.address_type) === 'bo_ShipTo');
  return hasBill && hasShip;
}

async function upsertCustomerLocation(supabase, customerId, siteId, addressType, payload, existingRows) {
  const typeNorm = normalizePortalAddressType(addressType);
  const locationRow = { ...payload, site_id: siteId, address_type: typeNorm };

  let existing = findExistingLocationRow(existingRows || [], locationRow);

  if (!existing && Array.isArray(existingRows) === false) {
    const rows = await loadCustomerLocations(supabase, customerId);
    if (rows === null) return null;
    existing = findExistingLocationRow(rows, locationRow);
  }

  if (existing?.id) {
    const merged = mergePortalLocationPayload(existing, payload);
    const { error: updErr } = await supabase
      .from("customer_location")
      .update(merged)
      .eq("id", existing.id);
    if (updErr) {
      console.warn(
        "ensurePortalCustomerAddressFromLead: customer_location update failed:",
        updErr.message
      );
      return null;
    }
    Object.assign(existing, merged);
    return existing.id;
  }

  const { data: inserted, error: insErr } = await supabase
    .from("customer_location")
    .insert(payload)
    .select("id, site_id, address_type, street, building, block, address, city, country_name, zip_code, location_id")
    .single();

  if (insErr) {
    console.warn(
      "ensurePortalCustomerAddressFromLead: customer_location insert failed:",
      insErr.message
    );
    return null;
  }

  if (inserted && Array.isArray(existingRows)) {
    existingRows.push(inserted);
  }

  return inserted?.id || null;
}

/**
 * Persist lead address onto portal customer + customer_location (customer detail tabs).
 * Jobs use `locations`; account/address tabs use `customer_location` + customer_address.
 * Creates both billing and shipping rows (same address), matching SAP lead conversion.
 *
 * Uses a stable site_id (prefer BP AddressName) for BOTH bill and ship — never invents
 * "{site} - 1" which fails to match SAP AddressName on inbound sync.
 *
 * @param {{ skipIfSapLocationsPresent?: boolean }} [options]
 */
export async function ensurePortalCustomerAddressFromLead({
  supabase,
  customerId,
  lead,
  locationId = null,
  skipIfSapLocationsPresent = false,
}) {

  const customerAddress = getCustomerAddressFromLead(lead);
  const locationName = buildLeadLocationName(lead);
  if (!customerAddress && locationName === "Main Location") {
    return null;
  }

  const customerUpdates = {};
  if (customerAddress) customerUpdates.customer_address = customerAddress;
  if (lead.block !== undefined) {
    customerUpdates.block =
      lead.block == null || lead.block === "" ? null : String(lead.block).trim();
  }
  if (lead.unit !== undefined) {
    customerUpdates.unit =
      lead.unit == null || lead.unit === "" ? null : String(lead.unit).trim();
  }

  if (Object.keys(customerUpdates).length > 0) {
    const { error: custErr } = await supabase
      .from("customer")
      .update(customerUpdates)
      .eq("id", customerId);
    if (custErr) {
      console.warn(
        "ensurePortalCustomerAddressFromLead: customer update failed:",
        custErr.message
      );
    }
  }

  let linkedLocationId = locationId;
  if (!linkedLocationId && locationName && locationName !== "Main Location") {
    const { data: locRow } = await supabase
      .from("locations")
      .select("id")
      .eq("customer_id", customerId)
      .eq("location_name", locationName)
      .is("deleted_at", null)
      .maybeSingle();
    if (locRow?.id) linkedLocationId = locRow.id;
  }

  if (!supabase || !customerId || !lead) return null;

  const existingRows = await loadCustomerLocations(supabase, customerId);
  if (existingRows === null) return null;

  if (skipIfSapLocationsPresent && hasSapStyleBillShipPair(existingRows)) {
    return {
      customerAddress,
      skipped: true,
      reason: 'sap_locations_present',
      siteId: existingRows.find((r) => normalizePortalAddressType(r.address_type) === 'bo_BillTo')?.site_id || null,
      shipSiteId: existingRows.find((r) => normalizePortalAddressType(r.address_type) === 'bo_ShipTo')?.site_id || null,
    };
  }

  // Prefer explicit AddressName from create payload / SAP; fall back to deriveSiteId.
  // Bill and Ship share the same site_id when they are the same physical address so
  // SAP inbound sync can match by AddressName + address_type instead of stacking.
  const billSiteId = (
    sanitizeAddressPart(lead.bill_address_name) ||
    sanitizeAddressPart(lead.address_name) ||
    deriveSiteId(lead)
  ).substring(0, 100);
  const shipSiteId = (
    sanitizeAddressPart(lead.ship_address_name) ||
    sanitizeAddressPart(lead.bill_address_name) ||
    sanitizeAddressPart(lead.address_name) ||
    billSiteId
  ).substring(0, 100);

  let linkedLocationRow = null;
  if (linkedLocationId) {
    const { data: locRow } = await supabase
      .from("locations")
      .select("id, location_name, street, address")
      .eq("id", linkedLocationId)
      .maybeSingle();
    linkedLocationRow = locRow || null;
  }

  const billPayload = buildLocationPayload(
    lead,
    customerId,
    customerAddress,
    "bo_BillTo",
    billSiteId,
    linkedLocationId
  );
  const shipPayload = buildLocationPayload(
    lead,
    customerId,
    customerAddress,
    "bo_ShipTo",
    shipSiteId,
    linkedLocationId
  );

  if (linkedLocationRow) {
    for (const payload of [billPayload, shipPayload]) {
      const resolvedStreet = resolveCustomerLocationStreet({
        ...payload,
        locations: linkedLocationRow,
      });
      if (resolvedStreet) {
        payload.street = resolvedStreet;
        payload.address = resolvedStreet;
      }
    }
    const headerStreet = resolveCustomerLocationStreet({
      ...billPayload,
      locations: linkedLocationRow,
    });
    if (headerStreet && headerStreet.includes(" ")) {
      customerUpdates.customer_address = headerStreet;
      const { error: custErr2 } = await supabase
        .from("customer")
        .update({ customer_address: headerStreet })
        .eq("id", customerId);
      if (custErr2) {
        console.warn(
          "ensurePortalCustomerAddressFromLead: customer_address enrich failed:",
          custErr2.message
        );
      }
    }
  }

  const billLocationId = await upsertCustomerLocation(
    supabase,
    customerId,
    billSiteId,
    "bo_BillTo",
    billPayload,
    existingRows
  );
  const shipLocationId = await upsertCustomerLocation(
    supabase,
    customerId,
    shipSiteId,
    "bo_ShipTo",
    shipPayload,
    existingRows
  );

  return {
    customerAddress,
    customerLocationId: billLocationId,
    shipLocationId,
    siteId: billSiteId,
    shipSiteId,
  };
}

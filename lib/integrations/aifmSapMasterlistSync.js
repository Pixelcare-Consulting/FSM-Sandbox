/**
 * Upsert SAP Business Partner hits (live Service Layer) into Supabase masterlist tables.
 * - CardType C → public.customer (portal masterlist customers)
 * - CardType L → public.sap_lead
 *
 * SAP READ-ONLY INVARIANT (address sync):
 * This module may only READ Business Partner data from SAP (getBusinessPartner /
 * getBusinessPartnerAddresses). It must NEVER PATCH/DELETE BPAddresses or change
 * SAP BilltoDefault / ShipToDefault. Ghost cleanup deletes portal `customer_location`
 * / `sap_lead_location` rows only.
 */

import { createRequire } from 'node:module';
import sapService from '../services/sapService.js';
import { ensureLocalCustomerFromSapHit } from './aifmAssignCustomersCore.js';
import { upsertSapLeadMasterlistFromSap } from '../leads/upsertSapLeadMasterlistFromSap.js';
import { propagateSiteAddressToJobs } from '../customers/propagateSiteAddressToJobs.js';
import { sanitizeAddressPart } from '../utils/formatPortalBpAddress.js';
import {
  BILL_SHIP_ADDRESS_TYPES,
  SHIP_MINUS_ONE_SUFFIX,
  formatSapAddressLine,
  sapAddressToLocationRow,
  mergeCustomerLocationRow,
  findExistingLocationRow,
  portalLocationCompositeKey,
  sapAddressCompositeKeys,
  normalizePortalAddressType,
  groupDuplicateBillShipByContent,
  pickCanonicalLocationRow,
} from './sapAddressLocationHelpers.js';
import { mergeSapBpAddressSources } from './sapAddressMergeHelpers.js';

export {
  formatSapAddressLine,
  resolveSapBuildingLine,
  mergeCustomerLocationRow,
  findExistingLocationRow,
  shouldPreferExistingLocationField,
  normPortalAddressContent,
  groupDuplicateBillShipByContent,
  pickCanonicalLocationRow,
} from './sapAddressLocationHelpers.js';

const require = createRequire(import.meta.url);

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key);
}

function normalizeSapCardCode(raw) {
  return String(raw || '').trim().toUpperCase();
}

/** Portal masterlist only stores SAP-confirmed C/L CardCodes. */
function isValidSapCardCode(code) {
  const normalized = normalizeSapCardCode(code);
  return /^[CL][A-Z0-9]+$/.test(normalized);
}

function dedupeHits(hits) {
  const byCode = new Map();
  for (const h of hits || []) {
    const cardCode = normalizeSapCardCode(h?.cardCode || h?.suggestedCardCode);
    if (!isValidSapCardCode(cardCode)) continue;
    const cardName = String(h?.cardName || h?.sapCardName || h?.accountName || '').trim();
    const cardType =
      h?.cardType ||
      h?.sapCardType ||
      (cardCode.startsWith('L') ? 'L' : cardCode.startsWith('C') ? 'C' : null);
    byCode.set(cardCode, { cardCode, cardName: cardName || cardCode, cardType });
  }
  return [...byCode.values()];
}

function formatBpHeaderAddress(bp) {
  if (!bp) return null;
  const parts = [
    sanitizeAddressPart(bp.Street),
    sanitizeAddressPart(bp.Block),
    sanitizeAddressPart(bp.Building),
    sanitizeAddressPart(bp.City),
    bp.Country === 'SG' ? 'Singapore' : sanitizeAddressPart(bp.Country),
    sanitizeAddressPart(bp.ZipCode),
  ].filter(Boolean);
  const header = sanitizeAddressPart(bp.Address) || sanitizeAddressPart(bp.MailAddress);
  return parts.join(', ') || header || null;
}

function buildAddressLabel(locationRow) {
  const siteId = sanitizeAddressPart(locationRow?.site_id) || '—';
  const type = normalizePortalAddressType(locationRow?.address_type);
  const typeLabel = type === 'bo_BillTo' ? 'Bill To' : type === 'bo_ShipTo' ? 'Ship To' : type || 'Site';
  return `${siteId} (${typeLabel})`;
}

async function countActiveJobsForLocationId(supabase, locationId) {
  if (!locationId) return 0;
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .is('deleted_at', null);
  if (error) throw new Error(`jobs count(location_id=${locationId}): ${error.message}`);
  return count || 0;
}

function countBillShipPortalRows(rows) {
  return (rows || []).filter((row) =>
    BILL_SHIP_ADDRESS_TYPES.has(normalizePortalAddressType(row.address_type))
  ).length;
}

function countBillShipSapAddresses(addrs) {
  return (addrs || []).filter((a) =>
    BILL_SHIP_ADDRESS_TYPES.has(normalizePortalAddressType(a?.AddressType))
  ).length;
}

/**
 * Remove FSM portal bill/ship rows that no longer exist in SAP.
 * Never writes to SAP — deletes are portal-table only.
 *
 * skipStaleDeletes: only when the SAP *read* looks incomplete (CRD1 empty while
 * OData still returned addresses, or explicit fetchError). Legitimate SAP-side
 * address deletions (fewer SAP rows than portal after a successful merge) must
 * remove matching FSM ghosts (unless jobs still reference them).
 */
async function dedupeStalePortalLocations({
  supabase,
  tableName,
  existingRows,
  bpAddresses,
  checkJobReferences = false,
  addressFetchMeta = null,
}) {
  let removed = 0;
  const removedLabels = [];
  const sapKeys = sapAddressCompositeKeys(bpAddresses);

  const portalBillShipCount = countBillShipPortalRows(existingRows);
  const sapBillShipCount = countBillShipSapAddresses(bpAddresses);
  const sqlCount = addressFetchMeta?.sqlCount;
  const odataCount = addressFetchMeta?.odataCount;
  // Incomplete fetch guard only — do NOT skip when SQL succeeded and SAP simply
  // has fewer bill/ship rows than the portal (that is the ghost-removal case).
  const skipStaleDeletes =
    Boolean(addressFetchMeta?.fetchError) ||
    (portalBillShipCount > 0 &&
      sqlCount === 0 &&
      (odataCount == null || odataCount > 0) &&
      portalBillShipCount > sapBillShipCount);

  if (skipStaleDeletes) {
    console.warn(
      `[dedupeStalePortalLocations] Skipping stale portal deletes — incomplete SAP address fetch ` +
        `(sqlCount=${sqlCount}, odataCount=${odataCount}, sapBillShip=${sapBillShipCount}, ` +
        `portalBillShip=${portalBillShipCount}). meta=${JSON.stringify(addressFetchMeta || {})}`
    );
  }

  const billSiteIds = new Set(
    existingRows
      .filter((row) => normalizePortalAddressType(row.address_type) === 'bo_BillTo')
      .map((row) => row.site_id)
      .filter(Boolean)
  );

  for (const billSiteId of billSiteIds) {
    const shipSuffixSiteId = `${billSiteId}${SHIP_MINUS_ONE_SUFFIX}`;
    const hasProperShip =
      existingRows.some(
        (row) =>
          normalizePortalAddressType(row.address_type) === 'bo_ShipTo' &&
          row.site_id === shipSuffixSiteId
      ) || sapKeys.has(`${shipSuffixSiteId}||bo_ShipTo`);
    if (!hasProperShip) continue;

    const phantoms = existingRows.filter(
      (row) =>
        normalizePortalAddressType(row.address_type) === 'bo_ShipTo' &&
        row.site_id === billSiteId
    );

    for (const dup of phantoms) {
      if (checkJobReferences && dup.location_id) {
        const jobCount = await countActiveJobsForLocationId(supabase, dup.location_id);
        if (jobCount > 0) continue;
      }
      const { error: delErr } = await supabase.from(tableName).delete().eq('id', dup.id);
      if (delErr) throw new Error(`${tableName} delete phantom ship: ${delErr.message}`);
      removed += 1;
      const dupIdx = existingRows.findIndex((row) => row.id === dup.id);
      if (dupIdx >= 0) existingRows.splice(dupIdx, 1);
    }
  }

  const sapShipSiteIds = new Set(
    (bpAddresses || [])
      .filter((a) => normalizePortalAddressType(a?.AddressType) === 'bo_ShipTo')
      .map((a) => sapAddressToLocationRow(a).site_id)
      .filter(Boolean)
  );

  for (const shipSiteId of sapShipSiteIds) {
    if (shipSiteId.endsWith(SHIP_MINUS_ONE_SUFFIX)) continue;
    const minusOneVariant = `${shipSiteId}${SHIP_MINUS_ONE_SUFFIX}`;
    if (sapShipSiteIds.has(minusOneVariant)) continue;

    const phantoms = existingRows.filter(
      (row) =>
        normalizePortalAddressType(row.address_type) === 'bo_ShipTo' &&
        row.site_id === minusOneVariant
    );

    for (const dup of phantoms) {
      if (checkJobReferences && dup.location_id) {
        const jobCount = await countActiveJobsForLocationId(supabase, dup.location_id);
        if (jobCount > 0) continue;
      }
      const { error: delErr } = await supabase.from(tableName).delete().eq('id', dup.id);
      if (delErr) throw new Error(`${tableName} delete phantom ship suffix: ${delErr.message}`);
      removed += 1;
      const dupIdx = existingRows.findIndex((row) => row.id === dup.id);
      if (dupIdx >= 0) existingRows.splice(dupIdx, 1);
    }
  }

  if (!skipStaleDeletes) {
    for (const portalRow of [...existingRows]) {
      const key = portalLocationCompositeKey(portalRow);
      if (sapKeys.has(key)) continue;
      const addrType = normalizePortalAddressType(portalRow.address_type);
      if (!BILL_SHIP_ADDRESS_TYPES.has(addrType)) continue;

      if (checkJobReferences && portalRow.location_id) {
        const jobCount = await countActiveJobsForLocationId(supabase, portalRow.location_id);
        if (jobCount > 0) continue;
      }

      const { error: delErr } = await supabase.from(tableName).delete().eq('id', portalRow.id);
      if (delErr) throw new Error(`${tableName} delete stale portal row: ${delErr.message}`);
      removed += 1;
      removedLabels.push(buildAddressLabel(portalRow));
      const rowIdx = existingRows.findIndex((row) => row.id === portalRow.id);
      if (rowIdx >= 0) existingRows.splice(rowIdx, 1);
    }
  }

  const sapSiteIds = new Set(
    (bpAddresses || [])
      .map((addr) => sapAddressToLocationRow(addr).site_id)
      .filter(Boolean),
  );

  // Collapse stacked Bill To / Ship To rows that share type + address content
  // (portal deriveSiteId vs SAP AddressName, or repeated ensure+sync).
  const contentGroups = groupDuplicateBillShipByContent(existingRows);
  for (const group of contentGroups.values()) {
    if (group.length < 2) continue;
    const preferred = pickCanonicalLocationRow(group, sapSiteIds);
    if (!preferred?.id) continue;
    for (const row of group) {
      if (row.id === preferred.id) continue;
      if (checkJobReferences && row.location_id) {
        const jobCount = await countActiveJobsForLocationId(supabase, row.location_id);
        if (jobCount > 0) continue;
      }
      const { error: delErr } = await supabase.from(tableName).delete().eq('id', row.id);
      if (delErr) {
        throw new Error(`${tableName} delete duplicate bill/ship content: ${delErr.message}`);
      }
      removed += 1;
      removedLabels.push(buildAddressLabel(row));
      const rowIdx = existingRows.findIndex((existing) => existing.id === row.id);
      if (rowIdx >= 0) existingRows.splice(rowIdx, 1);
    }
  }

  return { removed, removedLabels, skipStaleDeletes };
}

export async function fetchBpDetails(cardCode, sessionCookies) {
  const requestedCode = normalizeSapCardCode(cardCode);
  if (!sessionCookies || !isValidSapCardCode(requestedCode)) return null;
  try {
    const bp = await sapService.getBusinessPartner(requestedCode, sessionCookies);
    const confirmedCode = normalizeSapCardCode(bp?.CardCode);
    if (!isValidSapCardCode(confirmedCode)) return null;

    const odataAddresses = Array.isArray(bp?.BPAddresses) ? bp.BPAddresses : [];
    const sqlAddrs = await sapService.getBusinessPartnerAddresses(confirmedCode, sessionCookies);
    const sqlAddresses = (sqlAddrs || []).filter((a) => a?.AddressName || a?.Street);
    const { bpAddresses, meta: addressFetchMeta } = mergeSapBpAddressSources(
      odataAddresses,
      sqlAddresses
    );
    const firstAddressLine = bpAddresses.length > 0 ? formatSapAddressLine(bpAddresses[0]) : null;
    const billToDefault = sanitizeAddressPart(bp?.BilltoDefault) || null;
    const shipToDefault =
      sanitizeAddressPart(bp?.ShipToDefault) || sanitizeAddressPart(bp?.ShiptoDefault) || null;
    return {
      cardCode: confirmedCode,
      cardName: bp?.CardName || null,
      phone: bp?.Phone1 || bp?.Cellular || bp?.Phone2 || null,
      email: bp?.EmailAddress || null,
      address: formatBpHeaderAddress(bp) || firstAddressLine,
      billToDefault,
      shipToDefault,
      bpAddresses: Array.isArray(bpAddresses) ? bpAddresses : [],
      addressFetchMeta,
    };
  } catch {
    return null;
  }
}

export function buildCustomerFieldsFromDetails(customer_name, details, { isInsert = false, existingAddress = '' } = {}) {
  const row = {
    customer_name,
    updated_at: new Date().toISOString(),
  };
  if (isInsert) row.source = 'sap';
  if (!details) return row;

  if (details.phone) row.phone_number = details.phone;
  if (details.email) row.email = details.email;

  const incomingAddress = sanitizeAddressPart(details.address);
  const currentAddress = sanitizeAddressPart(existingAddress);
  if (incomingAddress && (!currentAddress || incomingAddress.length >= currentAddress.length)) {
    row.customer_address = incomingAddress;
  }

  // Always mirror SAP defaults onto FSM (including null clears). FSM columns only —
  // does not write BilltoDefault / ShipToDefault back to SAP.
  row.bill_to_default = details.billToDefault || null;
  row.ship_to_default = details.shipToDefault || null;

  row.synced_to_sap_at = new Date().toISOString();
  return row;
}

export async function upsertCustomerLocationsFromSap(
  supabase,
  customerId,
  bpAddresses,
  addressDefaults = {},
  addressFetchMeta = null
) {
  if (!customerId || !Array.isArray(bpAddresses) || bpAddresses.length === 0) {
    return { inserted: 0, updated: 0, removed: 0, jobLocations: { updated: 0 } };
  }

  let inserted = 0;
  let updated = 0;
  let removed = 0;

  // Include location_id so job-linked rows are preserved during FSM-only ghost cleanup.
  const { data: allExisting, error: listErr } = await supabase
    .from('customer_location')
    .select(
      'id, site_id, street, building, block, city, country_name, zip_code, address, address_type, location_id'
    )
    .eq('customer_id', customerId);
  if (listErr) throw new Error(`customer_location list: ${listErr.message}`);

  const existingRows = [...(allExisting || [])];

  for (const addr of bpAddresses) {
    const locationRow = sapAddressToLocationRow(addr);
    if (!locationRow.site_id) continue;

    const addrType = locationRow.address_type;

    if (addrType && BILL_SHIP_ADDRESS_TYPES.has(addrType)) {
      const existing = findExistingLocationRow(existingRows, locationRow);

      if (existing?.id) {
        const merged = mergeCustomerLocationRow(existing, locationRow);
        merged.site_id = locationRow.site_id;
        const { error: updErr } = await supabase
          .from('customer_location')
          .update(merged)
          .eq('id', existing.id);
        if (updErr) throw new Error(`customer_location update: ${updErr.message}`);
        updated += 1;
        Object.assign(existing, merged);
      } else {
        const { data: insertedRow, error: insErr } = await supabase
          .from('customer_location')
          .insert({ customer_id: customerId, ...locationRow })
          .select(
            'id, site_id, street, building, block, city, country_name, zip_code, address, address_type, location_id'
          )
          .single();
        if (insErr) throw new Error(`customer_location insert: ${insErr.message}`);
        inserted += 1;
        if (insertedRow?.id) existingRows.push(insertedRow);
      }
      continue;
    }

    const { data: existing, error: selErr } = await supabase
      .from('customer_location')
      .select(
        'id, site_id, street, building, block, city, country_name, zip_code, address, address_type, location_id'
      )
      .eq('customer_id', customerId)
      .eq('site_id', locationRow.site_id)
      .maybeSingle();
    if (selErr) throw new Error(`customer_location select: ${selErr.message}`);

    if (existing?.id) {
      const merged = mergeCustomerLocationRow(existing, locationRow);
      const { error: updErr } = await supabase
        .from('customer_location')
        .update(merged)
        .eq('id', existing.id);
      if (updErr) throw new Error(`customer_location update: ${updErr.message}`);
      updated += 1;
    } else {
      const { error: insErr } = await supabase
        .from('customer_location')
        .insert({ customer_id: customerId, ...locationRow });
      if (insErr) throw new Error(`customer_location insert: ${insErr.message}`);
      inserted += 1;
    }
  }

  const dedupeResult = await dedupeStalePortalLocations({
    supabase,
    tableName: 'customer_location',
    existingRows,
    bpAddresses,
    checkJobReferences: true,
    addressFetchMeta,
  });
  removed += dedupeResult.removed;

  const jobLocations = await patchJobLocationsFromSap(
    supabase,
    customerId,
    bpAddresses,
    addressDefaults
  );
  return {
    inserted,
    updated,
    removed,
    removedLabels: dedupeResult.removedLabels || [],
    skipStaleDeletes: dedupeResult.skipStaleDeletes,
    jobLocations,
  };
}

async function ensureSapLeadLocationLink(supabase, sapLeadLocationId, locationName) {
  if (!sapLeadLocationId) return null;

  const { data: row, error: selErr } = await supabase
    .from('sap_lead_location')
    .select('id, location_id')
    .eq('id', sapLeadLocationId)
    .maybeSingle();
  if (selErr) throw new Error(`sap_lead_location select for link: ${selErr.message}`);
  if (row?.location_id) return row.location_id;

  const name = sanitizeAddressPart(locationName) || '—';
  const { data: loc, error: locErr } = await supabase
    .from('locations')
    .insert({ customer_id: null, location_name: name })
    .select('id')
    .single();
  if (locErr) throw new Error(`locations insert (lead): ${locErr.message}`);

  const { error: linkErr } = await supabase
    .from('sap_lead_location')
    .update({ location_id: loc.id })
    .eq('id', sapLeadLocationId);
  if (linkErr) throw new Error(`sap_lead_location link: ${linkErr.message}`);

  return loc.id;
}

export async function upsertSapLeadLocationsFromSap(supabase, sapLeadId, bpAddresses) {
  if (!sapLeadId || !Array.isArray(bpAddresses) || bpAddresses.length === 0) {
    return { inserted: 0, updated: 0, removed: 0 };
  }

  let inserted = 0;
  let updated = 0;
  let removed = 0;

  const { data: allExisting, error: listErr } = await supabase
    .from('sap_lead_location')
    .select('id, site_id, street, building, block, city, country_name, zip_code, address, address_type, location_id')
    .eq('sap_lead_id', sapLeadId);
  if (listErr) throw new Error(`sap_lead_location list: ${listErr.message}`);

  const existingRows = [...(allExisting || [])];

  for (const addr of bpAddresses) {
    const locationRow = sapAddressToLocationRow(addr);
    if (!locationRow.site_id) continue;

    const addrType = locationRow.address_type;

    if (addrType && BILL_SHIP_ADDRESS_TYPES.has(addrType)) {
      const existing = findExistingLocationRow(existingRows, locationRow);

      if (existing?.id) {
        const merged = mergeCustomerLocationRow(existing, locationRow);
        merged.site_id = locationRow.site_id;
        const { error: updErr } = await supabase
          .from('sap_lead_location')
          .update(merged)
          .eq('id', existing.id);
        if (updErr) throw new Error(`sap_lead_location update: ${updErr.message}`);
        updated += 1;
        Object.assign(existing, merged);
        await ensureSapLeadLocationLink(supabase, existing.id, merged.address || locationRow.address);
      } else {
        const { data: insertedRow, error: insErr } = await supabase
          .from('sap_lead_location')
          .insert({ sap_lead_id: sapLeadId, ...locationRow })
          .select('id, site_id, street, building, block, city, country_name, zip_code, address, address_type, location_id')
          .single();
        if (insErr) throw new Error(`sap_lead_location insert: ${insErr.message}`);
        inserted += 1;
        if (insertedRow?.id) {
          existingRows.push(insertedRow);
          await ensureSapLeadLocationLink(supabase, insertedRow.id, locationRow.address);
        }
      }
      continue;
    }

    const { data: existing, error: selErr } = await supabase
      .from('sap_lead_location')
      .select('id, site_id, street, building, block, city, country_name, zip_code, address, address_type, location_id')
      .eq('sap_lead_id', sapLeadId)
      .eq('site_id', locationRow.site_id)
      .maybeSingle();
    if (selErr) throw new Error(`sap_lead_location select: ${selErr.message}`);

    if (existing?.id) {
      const merged = mergeCustomerLocationRow(existing, locationRow);
      const { error: updErr } = await supabase
        .from('sap_lead_location')
        .update(merged)
        .eq('id', existing.id);
      if (updErr) throw new Error(`sap_lead_location update: ${updErr.message}`);
      updated += 1;
      await ensureSapLeadLocationLink(supabase, existing.id, merged.address || locationRow.address);
    } else {
      const { data: insertedRow, error: insErr } = await supabase
        .from('sap_lead_location')
        .insert({ sap_lead_id: sapLeadId, ...locationRow })
        .select('id, location_id')
        .single();
      if (insErr) throw new Error(`sap_lead_location insert: ${insErr.message}`);
      inserted += 1;
      if (insertedRow?.id) {
        await ensureSapLeadLocationLink(supabase, insertedRow.id, locationRow.address);
      }
    }
  }

  const dedupeResult = await dedupeStalePortalLocations({
    supabase,
    tableName: 'sap_lead_location',
    existingRows,
    bpAddresses,
    checkJobReferences: false,
  });
  removed += dedupeResult.removed;

  return { inserted, updated, removed, removedLabels: dedupeResult.removedLabels || [] };
}

export function pickPreferredSapAddressForJobs(bpAddresses, { shipToDefault, billToDefault } = {}) {
  if (!Array.isArray(bpAddresses) || bpAddresses.length === 0) return null;

  const shipDefaultName = sanitizeAddressPart(shipToDefault);
  const billDefaultName = sanitizeAddressPart(billToDefault);

  let picked = null;
  if (shipDefaultName) {
    picked = bpAddresses.find((a) => sanitizeAddressPart(a?.AddressName) === shipDefaultName) || null;
  }
  if (!picked && billDefaultName) {
    picked = bpAddresses.find((a) => sanitizeAddressPart(a?.AddressName) === billDefaultName) || null;
  }
  if (!picked) {
    picked =
      bpAddresses.find((a) => normalizePortalAddressType(a?.AddressType) === 'bo_ShipTo') ||
      bpAddresses.find((a) => normalizePortalAddressType(a?.AddressType) === 'bo_BillTo') ||
      bpAddresses[0];
  }

  const row = sapAddressToLocationRow(picked);
  return row.address || formatSapAddressLine(picked) || null;
}

function sapAddressByCompositeKey(bpAddresses) {
  const map = new Map();
  for (const addr of bpAddresses || []) {
    const row = sapAddressToLocationRow(addr);
    if (!row.site_id) continue;
    map.set(portalLocationCompositeKey(row), { sapAddr: addr, row });
  }
  return map;
}

function locationNameForCustomerLocationRow(clRow, sapByKey) {
  const key = portalLocationCompositeKey(clRow);
  const sap = sapByKey.get(key);
  if (sap?.row?.address) return sap.row.address;
  if (sap?.sapAddr) return formatSapAddressLine(sap.sapAddr) || null;
  return sanitizeAddressPart(clRow.address) || null;
}

async function ensureCustomerLocationLinkedLocation(supabase, customerId, clRow, locationName) {
  const name = sanitizeAddressPart(locationName);
  if (!name) return null;

  const now = new Date().toISOString();

  if (clRow.location_id) {
    const { error } = await supabase
      .from('locations')
      .update({ location_name: name, updated_at: now })
      .eq('id', clRow.location_id)
      .is('deleted_at', null);
    if (error) throw new Error(`locations patch ${clRow.location_id}: ${error.message}`);
    return clRow.location_id;
  }

  const { data: loc, error: locErr } = await supabase
    .from('locations')
    .insert({ customer_id: customerId, location_name: name })
    .select('id')
    .single();
  if (locErr) throw new Error(`locations insert: ${locErr.message}`);

  const { error: linkErr } = await supabase
    .from('customer_location')
    .update({ location_id: loc.id })
    .eq('id', clRow.id);
  if (linkErr) throw new Error(`customer_location link ${clRow.id}: ${linkErr.message}`);

  return loc.id;
}

/** Jobs list/detail read `locations.location_name` — patch linked rows after SAP address sync. */
async function patchJobLocationsFromSap(supabase, customerId, bpAddresses, { shipToDefault, billToDefault } = {}) {
  const preferredAddress = pickPreferredSapAddressForJobs(bpAddresses, { shipToDefault, billToDefault });

  const { data: custLocs, error: clErr } = await supabase
    .from('customer_location')
    .select('id, site_id, address_type, address, location_id')
    .eq('customer_id', customerId);
  if (clErr) throw new Error(`customer_location lookup for location patch: ${clErr.message}`);

  const sapByKey = sapAddressByCompositeKey(bpAddresses);
  let updated = 0;
  let customerLocationsLinked = 0;
  let schedulesUpdated = 0;
  const propagatedLocationIds = new Set();

  for (const clRow of custLocs || []) {
    const locationName = locationNameForCustomerLocationRow(clRow, sapByKey);
    if (!locationName) continue;

    const hadLink = Boolean(clRow.location_id);
    const locId = await ensureCustomerLocationLinkedLocation(supabase, customerId, clRow, locationName);
    if (locId) {
      updated += 1;
      if (!hadLink) customerLocationsLinked += 1;
      if (!propagatedLocationIds.has(locId)) {
        propagatedLocationIds.add(locId);
        const propagation = await propagateSiteAddressToJobs(supabase, locId, locationName);
        schedulesUpdated += propagation.schedulesUpdated || 0;
      }
    }
  }

  // Jobs linked to locations not touched above still need per-site schedule rows (not customer-wide default).
  const { data: customerJobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('location_id')
    .eq('customer_id', customerId)
    .is('deleted_at', null);
  if (jobsErr) throw new Error(`jobs lookup for schedule patch: ${jobsErr.message}`);

  const jobLocationIds = [
    ...new Set((customerJobs || []).map((row) => row.location_id).filter(Boolean)),
  ];

  for (const locId of jobLocationIds) {
    if (propagatedLocationIds.has(locId)) continue;
    const { data: locRow, error: locErr } = await supabase
      .from('locations')
      .select('location_name')
      .eq('id', locId)
      .is('deleted_at', null)
      .maybeSingle();
    if (locErr) throw new Error(`locations lookup for schedule patch ${locId}: ${locErr.message}`);

    const locationName = sanitizeAddressPart(locRow?.location_name);
    if (!locationName) continue;

    propagatedLocationIds.add(locId);
    const propagation = await propagateSiteAddressToJobs(supabase, locId, locationName);
    schedulesUpdated += propagation.schedulesUpdated || 0;
  }

  return { updated, locationName: preferredAddress, schedulesUpdated, customerLocationsLinked };
}

async function upsertPortalCustomer(supabase, hit, sessionCookies) {
  const customer_code = normalizeSapCardCode(hit?.cardCode);
  if (!isValidSapCardCode(customer_code)) {
    throw new Error('Missing or invalid SAP CardCode — not saved');
  }
  if (!sessionCookies) {
    throw new Error(`SAP session unavailable — ${customer_code} not saved`);
  }

  const details = await fetchBpDetails(customer_code, sessionCookies);
  if (!details?.cardCode) {
    throw new Error(`SAP Business Partner ${customer_code} not confirmed — not saved`);
  }

  const customer_name = details.cardName || hit.cardName || details.cardCode;

  const { data: existing, error: selErr } = await supabase
    .from('customer')
    .select('id, customer_code, customer_name, customer_address')
    .eq('customer_code', details.cardCode)
    .is('deleted_at', null)
    .maybeSingle();
  if (selErr) throw new Error(`customer select ${details.cardCode}: ${selErr.message}`);

  let customerId = existing?.id;

  if (existing?.id) {
    const patch = buildCustomerFieldsFromDetails(customer_name, details, {
      existingAddress: existing.customer_address,
    });
    const { error: updErr } = await supabase
      .from('customer')
      .update(patch)
      .eq('id', existing.id);
    if (updErr) throw new Error(`customer update ${details.cardCode}: ${updErr.message}`);
  } else {
    const insertRow = buildCustomerFieldsFromDetails(customer_name, details, { isInsert: true });
    const { data: inserted, error: insErr } = await supabase
      .from('customer')
      .insert({ customer_code: details.cardCode, ...insertRow })
      .select('id, customer_code, customer_name')
      .single();
    if (insErr) throw new Error(`customer insert ${details.cardCode}: ${insErr.message}`);
    customerId = inserted.id;
  }

  const addressDefaults = {
    billToDefault: details.billToDefault,
    shipToDefault: details.shipToDefault,
  };

  const locationsSummary = details.bpAddresses?.length
    ? await upsertCustomerLocationsFromSap(
        supabase,
        customerId,
        details.bpAddresses,
        addressDefaults,
        details.addressFetchMeta
      )
    : { inserted: 0, updated: 0, removed: 0 };

  return {
    action: existing?.id ? 'updated' : 'inserted',
    customer_code: details.cardCode,
    customer_name,
    id: customerId,
    locations: locationsSummary,
  };
}

async function upsertSapLead(supabase, hit, sessionCookies) {
  const lead_code = normalizeSapCardCode(hit?.cardCode);
  if (!isValidSapCardCode(lead_code)) {
    throw new Error('Missing or invalid SAP CardCode — not saved');
  }
  if (!sessionCookies) {
    throw new Error(`SAP session unavailable — ${lead_code} not saved`);
  }

  const core = await upsertSapLeadMasterlistFromSap({
    supabase,
    sapCardCode: lead_code,
    sessionCookies,
    cardName: hit.cardName,
  });

  const details = await fetchBpDetails(lead_code, sessionCookies);
  if (!details?.cardCode) {
    throw new Error(`SAP Business Partner ${lead_code} not confirmed — not saved`);
  }

  const lead_name = core.lead_name;
  const phone_number = details.phone || null;
  const email = details.email || null;

  const portalCustomer = await ensureLocalCustomerFromSapHit(
    { cardCode: details.cardCode, cardName: lead_name },
    lead_name,
    supabase
  );

  let portalLocationsSummary = { inserted: 0, updated: 0, removed: 0 };
  if (portalCustomer?.id && details.bpAddresses?.length) {
    portalLocationsSummary = await upsertCustomerLocationsFromSap(
      supabase,
      portalCustomer.id,
      details.bpAddresses,
      {
        billToDefault: details.billToDefault,
        shipToDefault: details.shipToDefault,
      },
      details.addressFetchMeta
    );
  }

  if (portalCustomer?.id) {
    const customerPatch = buildCustomerFieldsFromDetails(lead_name, details, {
      existingAddress: portalCustomer.customer_address,
    });
    if (details.address) customerPatch.customer_address = details.address;
    if (phone_number) customerPatch.phone_number = phone_number;
    if (email) customerPatch.email = email;
    await supabase.from('customer').update(customerPatch).eq('id', portalCustomer.id);
  }

  return {
    action: core.action,
    lead_code: details.cardCode,
    lead_name,
    id: core.id,
    locations: core.locations,
    portalCustomer: portalCustomer
      ? {
          id: portalCustomer.id,
          customer_code: portalCustomer.customer_code,
          customer_name: portalCustomer.customer_name,
        }
      : null,
    portalCustomerLocations: portalCustomer?.id ? portalLocationsSummary : null,
  };
}

/**
 * @param {Array<{ cardCode: string, cardName?: string, cardType?: string }>} hits
 * @param {{ sessionCookies?: object, supabase?: object }} [options]
 */
export async function syncSapHitsToMasterlist(hits, options = {}) {
  const supabase = options.supabase || getSupabaseAdmin();
  const sessionCookies = options.sessionCookies || null;
  const unique = dedupeHits(hits);

  const summary = {
    total: unique.length,
    customers: { inserted: 0, updated: 0, failed: 0 },
    leads: { inserted: 0, updated: 0, failed: 0 },
    locations: { inserted: 0, updated: 0, removed: 0 },
    locationWarnings: [],
    errors: [],
  };

  for (const hit of unique) {
    const isLead =
      hit.cardType === 'L' || String(hit.cardCode).toUpperCase().startsWith('L');

    try {
      if (isLead) {
        const r = await upsertSapLead(supabase, hit, sessionCookies);
        if (r.action === 'inserted') summary.leads.inserted++;
        else summary.leads.updated++;
        if (r.portalCustomerLocations) {
          summary.locations.inserted += r.portalCustomerLocations.inserted || 0;
          summary.locations.updated += r.portalCustomerLocations.updated || 0;
          summary.locations.removed += r.portalCustomerLocations.removed || 0;
        } else if (r.locations) {
          summary.locations.inserted += r.locations.inserted || 0;
          summary.locations.updated += r.locations.updated || 0;
          summary.locations.removed += r.locations.removed || 0;
        }
      } else {
        const r = await upsertPortalCustomer(supabase, hit, sessionCookies);
        if (r.action === 'inserted') summary.customers.inserted++;
        else summary.customers.updated++;
        if (r.locations) {
          summary.locations.inserted += r.locations.inserted || 0;
          summary.locations.updated += r.locations.updated || 0;
          summary.locations.removed += r.locations.removed || 0;
          if ((r.locations.removed || 0) > 0) {
            summary.locationWarnings.push({
              cardCode: r.customer_code,
              removed: r.locations.removed,
              removedLabels: r.locations.removedLabels || [],
            });
          }
        }
      }
    } catch (e) {
      summary.errors.push({ cardCode: hit.cardCode, error: e?.message || String(e) });
      if (isLead) summary.leads.failed++;
      else summary.customers.failed++;
    }
  }

  return summary;
}

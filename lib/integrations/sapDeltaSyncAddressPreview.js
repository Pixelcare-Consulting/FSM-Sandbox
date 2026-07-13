import { sanitizeAddressPart } from '../utils/formatPortalBpAddress.js';
import {
  BILL_SHIP_ADDRESS_TYPES,
  findExistingLocationRow,
  mergeCustomerLocationRow,
  normalizePortalAddressType,
  portalLocationCompositeKey,
  sapAddressCompositeKeys,
  sapAddressToLocationRow,
} from './sapAddressLocationHelpers.js';
import { normalizeCustomerCode } from './sapDeltaSyncCore.js';

const LOCATION_SELECT =
  'id, site_id, street, building, block, city, country_name, zip_code, address, address_type, location_id';
const BATCH_LOOKUP_SIZE = 200;
const SAP_DETAILS_CONCURRENCY = 6;
const JOB_SAMPLE_LIMIT = 5;

function addressTypeDisplayLabel(rawType) {
  const t = normalizePortalAddressType(rawType);
  if (t === 'bo_BillTo') return 'Bill To';
  if (t === 'bo_ShipTo') return 'Ship To';
  return t || 'Site';
}

function buildAddressLabel(locationRow) {
  const siteId = sanitizeAddressPart(locationRow?.site_id) || '—';
  return `${siteId} (${addressTypeDisplayLabel(locationRow?.address_type)})`;
}

/** Single-line display for portal `customer_location` / `sap_lead_location` rows. */
export function formatPortalLocationLine(row) {
  if (!row) return null;
  const full = sanitizeAddressPart(row.address);
  if (full) return full;
  const parts = [
    row.street,
    row.building,
    row.block,
    row.city,
    row.country_name,
    row.zip_code,
  ]
    .map(sanitizeAddressPart)
    .filter(Boolean);
  return parts.join(', ') || null;
}

function addressLinesEqual(a, b) {
  const left = sanitizeAddressPart(a).toLowerCase().replace(/\s+/g, ' ');
  const right = sanitizeAddressPart(b).toLowerCase().replace(/\s+/g, ' ');
  if (!left && !right) return true;
  return left === right;
}

/**
 * Dry-run address upsert — mirrors `upsertCustomerLocationsFromSap` / lead variant without writes.
 * Matches portal rows by `site_id` + `address_type` (including ship ` - 1` alias).
 * Removals are FSM-portal only (never SAP BPAddresses).
 *
 * @param {object[]} existingRows Portal location rows
 * @param {object[]} bpAddresses SAP BPAddresses from Service Layer
 * @returns {{ label: string, before: string|null, after: string|null, action: 'add'|'update'|'unchanged'|'remove', locationId?: string|null, portalLocationId?: string|null }[]}
 */
export function computeAddressChangesForEntity(existingRows, bpAddresses) {
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const sapAddrs = Array.isArray(bpAddresses) ? bpAddresses : [];
  const changes = [];
  const matchedPortalIds = new Set();

  for (const addr of sapAddrs) {
    const locationRow = sapAddressToLocationRow(addr);
    if (!locationRow.site_id) continue;

    const addrType = locationRow.address_type;
    let portalRow = null;

    if (addrType && BILL_SHIP_ADDRESS_TYPES.has(addrType)) {
      portalRow = findExistingLocationRow(existing, locationRow);
    } else {
      portalRow = existing.find((row) => row.site_id === locationRow.site_id) || null;
    }

    const label = buildAddressLabel(locationRow);

    if (portalRow?.id) {
      matchedPortalIds.add(portalRow.id);
      const merged = mergeCustomerLocationRow(portalRow, locationRow);
      merged.site_id = locationRow.site_id;
      const beforeLine = formatPortalLocationLine(portalRow);
      const afterLine = formatPortalLocationLine(merged);
      changes.push({
        label,
        before: beforeLine,
        after: afterLine,
        action: addressLinesEqual(beforeLine, afterLine) ? 'unchanged' : 'update',
      });
    } else {
      changes.push({
        label,
        before: null,
        after: formatPortalLocationLine(locationRow),
        action: 'add',
      });
    }
  }

  const sapKeys = sapAddressCompositeKeys(sapAddrs);
  for (const portalRow of existing) {
    if (matchedPortalIds.has(portalRow.id)) continue;
    const addrType = normalizePortalAddressType(portalRow.address_type);
    if (!BILL_SHIP_ADDRESS_TYPES.has(addrType)) continue;
    if (sapKeys.has(portalLocationCompositeKey(portalRow))) continue;
    changes.push({
      label: buildAddressLabel(portalRow),
      before: formatPortalLocationLine(portalRow),
      after: null,
      action: 'remove',
      // Used by enrichPreviewItemsWithAddresses for job-linked skip warnings.
      portalLocationId: portalRow.id || null,
      locationId: portalRow.location_id || null,
    });
  }

  return changes;
}

async function getActiveJobInfoForLocationId(supabase, locationId) {
  if (!locationId) return { jobCount: 0, jobNumbers: [] };
  const { data, count, error } = await supabase
    .from('jobs')
    .select('job_number', { count: 'exact' })
    .eq('location_id', locationId)
    .is('deleted_at', null)
    .limit(JOB_SAMPLE_LIMIT);
  if (error) throw new Error(`jobs sample(location_id=${locationId}): ${error.message}`);
  return {
    jobCount: count || 0,
    jobNumbers: (data || []).map((row) => row.job_number).filter(Boolean),
  };
}

/**
 * Attach jobCount / willSkip / jobNumbers onto remove rows (FSM-only impact).
 */
export async function enrichAddressRemoveRowsWithJobInfo(supabase, addressChanges) {
  if (!Array.isArray(addressChanges) || !addressChanges.length) return addressChanges || [];
  const enriched = [];
  for (const row of addressChanges) {
    if (row.action !== 'remove') {
      enriched.push(row);
      continue;
    }
    const { jobCount, jobNumbers } = await getActiveJobInfoForLocationId(
      supabase,
      row.locationId
    );
    enriched.push({
      ...row,
      jobCount,
      willSkip: jobCount > 0,
      jobNumbers,
    });
  }
  return enriched;
}

function previewItemKey(item) {
  return `${item.action}|${item.cardCode}|${item.portalCode || ''}`;
}

function portalLookupCodeForItem(item) {
  if (item.action === 'promote' && item.portalCode) {
    return normalizeCustomerCode(item.portalCode);
  }
  if (item.entityType === 'customer') {
    return normalizeCustomerCode(item.cardCode);
  }
  return null;
}

function leadLookupCodeForItem(item) {
  if (item.entityType === 'lead') {
    return normalizeCustomerCode(item.cardCode);
  }
  return null;
}

async function batchLookupCustomerIds(supabase, codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  const byCode = new Map();
  for (let i = 0; i < unique.length; i += BATCH_LOOKUP_SIZE) {
    const chunk = unique.slice(i, i + BATCH_LOOKUP_SIZE);
    const { data, error } = await supabase
      .from('customer')
      .select('id, customer_code')
      .in('customer_code', chunk)
      .is('deleted_at', null);
    if (error) throw new Error(`Customer id batch lookup failed: ${error.message}`);
    for (const row of data || []) {
      byCode.set(normalizeCustomerCode(row.customer_code), row.id);
    }
  }
  return byCode;
}

async function batchLookupLeadIds(supabase, codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  const byCode = new Map();
  for (let i = 0; i < unique.length; i += BATCH_LOOKUP_SIZE) {
    const chunk = unique.slice(i, i + BATCH_LOOKUP_SIZE);
    const { data, error } = await supabase
      .from('sap_lead')
      .select('id, lead_code')
      .in('lead_code', chunk)
      .is('deleted_at', null);
    if (error) throw new Error(`SAP lead id batch lookup failed: ${error.message}`);
    for (const row of data || []) {
      byCode.set(normalizeCustomerCode(row.lead_code), row.id);
    }
  }
  return byCode;
}

async function batchLookupCustomerLocations(supabase, customerIds) {
  const unique = [...new Set(customerIds.filter(Boolean))];
  const byCustomerId = new Map();
  for (let i = 0; i < unique.length; i += BATCH_LOOKUP_SIZE) {
    const chunk = unique.slice(i, i + BATCH_LOOKUP_SIZE);
    const { data, error } = await supabase
      .from('customer_location')
      .select(LOCATION_SELECT)
      .in('customer_id', chunk);
    if (error) throw new Error(`customer_location batch lookup failed: ${error.message}`);
    for (const row of data || []) {
      if (!byCustomerId.has(row.customer_id)) byCustomerId.set(row.customer_id, []);
      byCustomerId.get(row.customer_id).push(row);
    }
  }
  return byCustomerId;
}

async function batchLookupLeadLocations(supabase, leadIds) {
  const unique = [...new Set(leadIds.filter(Boolean))];
  const byLeadId = new Map();
  for (let i = 0; i < unique.length; i += BATCH_LOOKUP_SIZE) {
    const chunk = unique.slice(i, i + BATCH_LOOKUP_SIZE);
    const { data, error } = await supabase
      .from('sap_lead_location')
      .select(LOCATION_SELECT)
      .in('sap_lead_id', chunk);
    if (error) throw new Error(`sap_lead_location batch lookup failed: ${error.message}`);
    for (const row of data || []) {
      if (!byLeadId.has(row.sap_lead_id)) byLeadId.set(row.sap_lead_id, []);
      byLeadId.get(row.sap_lead_id).push(row);
    }
  }
  return byLeadId;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

/**
 * Attach `addressChanges` to preview items (customers + leads). Only loads locations for listed items.
 *
 * @param {{
 *   supabase: import('@supabase/supabase-js').SupabaseClient,
 *   sessionCookies: object,
 *   items: object[],
 * }} params
 */
export async function enrichPreviewItemsWithAddresses({ supabase, sessionCookies, items }) {
  const addressable = (items || []).filter(
    (item) => item.action !== 'skip' && (item.entityType === 'customer' || item.entityType === 'lead')
  );
  if (!addressable.length || !sessionCookies) {
    return items || [];
  }

  const customerCodes = addressable
    .filter((item) => item.entityType === 'customer')
    .map(portalLookupCodeForItem)
    .filter(Boolean);
  const leadCodes = addressable.map(leadLookupCodeForItem).filter(Boolean);

  const [customerIdByCode, leadIdByCode] = await Promise.all([
    customerCodes.length ? batchLookupCustomerIds(supabase, customerCodes) : Promise.resolve(new Map()),
    leadCodes.length ? batchLookupLeadIds(supabase, leadCodes) : Promise.resolve(new Map()),
  ]);

  const customerIds = [...customerIdByCode.values()];
  const leadIds = [...leadIdByCode.values()];

  const [locationsByCustomerId, locationsByLeadId] = await Promise.all([
    customerIds.length ? batchLookupCustomerLocations(supabase, customerIds) : Promise.resolve(new Map()),
    leadIds.length ? batchLookupLeadLocations(supabase, leadIds) : Promise.resolve(new Map()),
  ]);

  const uniqueCardCodes = [...new Set(addressable.map((item) => normalizeCustomerCode(item.cardCode)).filter(Boolean))];
  const sapDetailsByCode = new Map();
  const { fetchBpDetails } = await import('./aifmSapMasterlistSync.js');

  await mapWithConcurrency(uniqueCardCodes, SAP_DETAILS_CONCURRENCY, async (cardCode) => {
    const details = await fetchBpDetails(cardCode, sessionCookies);
    if (details?.cardCode) {
      sapDetailsByCode.set(normalizeCustomerCode(details.cardCode), details);
    }
  });

  const changesByItemKey = new Map();

  for (const item of addressable) {
    const cardCode = normalizeCustomerCode(item.cardCode);
    const details = sapDetailsByCode.get(cardCode);
    const bpAddresses = details?.bpAddresses || [];

    let existingRows = [];
    if (item.entityType === 'customer') {
      const portalCode = portalLookupCodeForItem(item);
      const customerId = portalCode ? customerIdByCode.get(portalCode) : null;
      if (customerId) existingRows = locationsByCustomerId.get(customerId) || [];
    } else if (item.entityType === 'lead') {
      const leadId = leadIdByCode.get(cardCode);
      if (leadId) existingRows = locationsByLeadId.get(leadId) || [];
    }

    const addressChanges = await enrichAddressRemoveRowsWithJobInfo(
      supabase,
      computeAddressChangesForEntity(existingRows, bpAddresses)
    );
    changesByItemKey.set(previewItemKey(item), addressChanges);
  }

  return (items || []).map((item) => {
    const addressChanges = changesByItemKey.get(previewItemKey(item));
    if (!addressChanges) return item;
    return { ...item, addressChanges };
  });
}

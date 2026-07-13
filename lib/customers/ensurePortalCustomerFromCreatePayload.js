import { ensurePortalCustomerAddressFromLead } from './ensurePortalCustomerAddressFromLead.js';
import {
  mapCreatePayloadToLeadShape,
  mapCreatePayloadToContacts,
  mapCreatePayloadToExtraLocations,
} from './portalCustomerFieldMap.js';
import { sanitizeAddressPart } from '../utils/formatPortalBpAddress.js';
import {
  findExistingLocationRow,
  normalizePortalAddressType,
} from '../integrations/sapAddressLocationHelpers.js';

async function upsertExtraCustomerLocation(supabase, customerId, site, existingRows) {
  const siteId = String(site.siteId || 'Additional').substring(0, 100);
  const addressType = site.addressType || 'bo_ShipTo';
  const payload = {
    customer_id: customerId,
    site_id: siteId,
    building: site.building || null,
    street: site.street || null,
    block: site.block || null,
    address: sanitizeAddressPart(site.address) || site.address || null,
    city: 'SG',
    country_name: site.country === 'SG' ? 'Singapore' : site.country || 'Singapore',
    zip_code: site.postcode || null,
    address_type: addressType,
  };

  const existing =
    findExistingLocationRow(existingRows || [], payload) ||
    (existingRows || []).find(
      (r) =>
        r.site_id === siteId &&
        normalizePortalAddressType(r.address_type) === normalizePortalAddressType(addressType)
    );

  if (existing?.id) {
    await supabase.from('customer_location').update(payload).eq('id', existing.id);
    Object.assign(existing, payload);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from('customer_location')
    .insert(payload)
    .select('id, site_id, address_type, street, building, block, address, city, country_name, zip_code')
    .single();

  if (error) {
    console.warn('ensurePortalCustomerFromCreatePayload: extra location insert failed:', error.message);
    return null;
  }
  if (inserted && Array.isArray(existingRows)) existingRows.push(inserted);
  return inserted?.id || null;
}

/**
 * After customer create, persist addresses, contacts, and extra locations from create payload.
 * Primary Bill To / Ship To use stable BPAddresses[].AddressName as site_id (no "- 1" invent).
 */
export async function ensurePortalCustomerFromCreatePayload({ supabase, customerId, payload }) {
  if (!supabase || !customerId || !payload) return null;

  const leadShape = mapCreatePayloadToLeadShape(payload);

  let addressResult = null;
  try {
    addressResult = await ensurePortalCustomerAddressFromLead({
      supabase,
      customerId,
      lead: leadShape,
    });
  } catch (addrErr) {
    console.warn('ensurePortalCustomerFromCreatePayload: address sync failed:', addrErr?.message);
  }

  const { data: existingLocs } = await supabase
    .from('customer_location')
    .select('id, site_id, address_type, street, building, block, address, city, country_name, zip_code')
    .eq('customer_id', customerId);
  const existingRows = [...(existingLocs || [])];

  const extras = mapCreatePayloadToExtraLocations(payload);
  for (const site of extras) {
    try {
      await upsertExtraCustomerLocation(supabase, customerId, site, existingRows);
    } catch (extraErr) {
      console.warn('ensurePortalCustomerFromCreatePayload: extra site failed:', extraErr?.message);
    }
  }

  const contacts = mapCreatePayloadToContacts(payload);
  if (contacts.length > 0) {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('customer_id', customerId)
      .limit(1);

    if (!existing || existing.length === 0) {
      const rows = contacts.map((c) => ({ ...c, customer_id: customerId }));
      const { error: contactErr } = await supabase.from('contacts').insert(rows);
      if (contactErr) {
        console.warn('ensurePortalCustomerFromCreatePayload: contacts insert failed:', contactErr.message);
      }
    }
  }

  return addressResult;
}

/**
 * PATCH — update a row in public.customer (Supabase masterlist) and upsert contacts:
 * customer-level when body.customer_location_id is omitted, or scoped to a site when set.
 */

import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
  buildChanges,
} from '../../../../lib/services/auditLog';
import {
  buildContactSnapshot,
  buildCustomerSnapshot,
  buildCreateChanges,
  mergeChanges,
} from '../../../../utils/auditSnapshots';
import customerCache from '../../../../lib/utils/customerCache';

function jsonBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body || {};
}

function splitPersonName(full) {
  const s = String(full || '').trim();
  if (!s) return { first_name: '-', last_name: '-' };
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first_name: parts[0], last_name: '-' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') || '-' };
}

const CONTACT_SELECT = 'id, first_name, last_name, email, tel1, customer_location_id';

async function fetchScopedContact(supabase, customerId, rawLocId, contactId) {
  if (contactId) {
    const { data } = await supabase
      .from('contacts')
      .select(CONTACT_SELECT)
      .eq('id', contactId)
      .eq('customer_id', customerId)
      .maybeSingle();
    return data;
  }

  let contactQ = supabase.from('contacts').select(CONTACT_SELECT).eq('customer_id', customerId);
  if (rawLocId) {
    contactQ = contactQ.eq('customer_location_id', rawLocId);
  } else {
    contactQ = contactQ.is('customer_location_id', null);
  }
  const { data: existingList } = await contactQ.order('id', { ascending: true }).limit(1);
  return existingList?.[0] ?? null;
}

function contactDeleteChanges(contact) {
  const snap = buildContactSnapshot(contact);
  const changes = {};
  for (const [key, val] of Object.entries(snap)) {
    if (val != null && val !== '') {
      changes[key] = { before: val, after: null };
    }
  }
  return Object.keys(changes).length ? changes : null;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const rawCode = req.query.cardCode;
  const cardCode = rawCode ? String(rawCode).trim() : '';
  if (!cardCode) {
    return res.status(400).json({ success: false, error: 'cardCode required' });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return res.status(503).json({ success: false, error: 'Database unavailable' });
  }

  const body = jsonBody(req);

  const rawLocId =
    body.customer_location_id != null && String(body.customer_location_id).trim() !== ''
      ? String(body.customer_location_id).trim()
      : null;

  const { data: customer, error: findErr } = await supabase
    .from('customer')
    .select('id, customer_code, customer_name, phone_number, email, customer_address')
    .eq('customer_code', cardCode)
    .is('deleted_at', null)
    .maybeSingle();

  if (findErr) {
    console.error('masterlist customer find:', findErr);
    return res.status(500).json({ success: false, error: findErr.message });
  }
  if (!customer?.id) {
    return res.status(404).json({
      success: false,
      error:
        'No Supabase masterlist row for this code. Edits apply only to imported SAP customers in the portal database.',
    });
  }

  if (rawLocId) {
    const { data: locRow, error: locErr } = await supabase
      .from('customer_location')
      .select('id')
      .eq('id', rawLocId)
      .eq('customer_id', customer.id)
      .maybeSingle();
    if (locErr) {
      console.error('masterlist customer location verify:', locErr);
      return res.status(500).json({ success: false, error: locErr.message });
    }
    if (!locRow) {
      return res.status(400).json({
        success: false,
        error: 'customer_location_id is invalid or does not belong to this customer',
      });
    }
  }

  const beforeCustomerSnapshot = buildCustomerSnapshot(customer);

  const rawDeleteContactId =
    body.delete_contact_id != null && String(body.delete_contact_id).trim() !== ''
      ? String(body.delete_contact_id).trim()
      : null;

  if (rawDeleteContactId) {
    const { data: contactBefore } = await supabase
      .from('contacts')
      .select(CONTACT_SELECT)
      .eq('id', rawDeleteContactId)
      .eq('customer_id', customer.id)
      .maybeSingle();

    let delQ = supabase
      .from('contacts')
      .delete()
      .eq('id', rawDeleteContactId)
      .eq('customer_id', customer.id);
    if (rawLocId) {
      delQ = delQ.eq('customer_location_id', rawLocId);
    } else {
      delQ = delQ.is('customer_location_id', null);
    }
    const { data: deletedRows, error: delErr } = await delQ.select('id');
    if (delErr) {
      console.error('masterlist contact delete:', delErr);
      return res.status(500).json({ success: false, error: delErr.message });
    }
    if (!deletedRows?.length) {
      return res.status(404).json({ success: false, error: 'Contact not found or not in this scope' });
    }
    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.CUSTOMER_UPDATE,
      category: AUDIT_CATEGORIES.CUSTOMER,
      entityType: 'customer',
      entityId: customer.id,
      entityLabel: customer.customer_name || cardCode,
      description: `Masterlist contact removed for ${cardCode}`,
      details: { subAction: 'delete_contact', contactId: rawDeleteContactId, customerLocationId: rawLocId },
      changes: contactDeleteChanges(contactBefore),
      status: AUDIT_STATUS.SUCCESS,
    });
    return res.status(200).json({ success: true, message: 'Contact removed' });
  }

  const custUpdates = {};
  if (body.customer_name !== undefined) {
    custUpdates.customer_name = String(body.customer_name || '').trim() || customer.customer_name;
  }
  if (body.phone_number !== undefined) {
    custUpdates.phone_number = body.phone_number ? String(body.phone_number).trim() : null;
  }
  if (body.email !== undefined) custUpdates.email = body.email ? String(body.email).trim() : null;
  if (body.customer_address !== undefined) {
    custUpdates.customer_address = body.customer_address
      ? String(body.customer_address).trim()
      : null;
  }

  const hasContactPayload =
    body.contact_person !== undefined ||
    body.contact_first_name !== undefined ||
    body.contact_last_name !== undefined ||
    body.contact_email !== undefined ||
    body.contact_phone !== undefined;

  const rawContactId =
    body.contact_id != null && String(body.contact_id).trim() !== ''
      ? String(body.contact_id).trim()
      : null;

  const beforeContact = hasContactPayload
    ? await fetchScopedContact(supabase, customer.id, rawLocId, rawContactId)
    : null;
  const beforeContactSnapshot = buildContactSnapshot(beforeContact);

  if (Object.keys(custUpdates).length > 0) {
    custUpdates.updated_at = new Date().toISOString();
    const { error: upErr } = await supabase.from('customer').update(custUpdates).eq('id', customer.id);
    if (upErr) {
      console.error('masterlist customer update:', upErr);
      return res.status(500).json({ success: false, error: upErr.message });
    }
  }

  let contactWasInsert = false;

  if (hasContactPayload) {
    let first_name = '-';
    let last_name = '-';
    if (body.contact_person !== undefined && String(body.contact_person).trim()) {
      const sp = splitPersonName(body.contact_person);
      first_name = sp.first_name;
      last_name = sp.last_name;
    } else {
      if (body.contact_first_name !== undefined) {
        first_name = String(body.contact_first_name || '').trim() || '-';
      }
      if (body.contact_last_name !== undefined) {
        last_name = String(body.contact_last_name || '').trim() || '-';
      }
    }

    const contactEmail =
      body.contact_email !== undefined
        ? body.contact_email
          ? String(body.contact_email).trim()
          : null
        : undefined;
    const contactPhone =
      body.contact_phone !== undefined
        ? body.contact_phone
          ? String(body.contact_phone).trim()
          : null
        : undefined;

    const forceNewSiteContact =
      rawLocId && body.create_new_site_contact === true && !rawContactId;

    const payload = {
      customer_id: customer.id,
      customer_location_id: rawLocId,
      first_name,
      last_name,
      middle_name: null,
    };
    if (contactEmail !== undefined) payload.email = contactEmail;
    if (contactPhone !== undefined) payload.tel1 = contactPhone;

    if (rawContactId) {
      const { data: verified, error: verErr } = await supabase
        .from('contacts')
        .select('id, customer_location_id')
        .eq('id', rawContactId)
        .eq('customer_id', customer.id)
        .maybeSingle();
      if (verErr) {
        console.error('masterlist contact verify:', verErr);
        return res.status(500).json({ success: false, error: verErr.message });
      }
      if (!verified?.id) {
        return res.status(400).json({ success: false, error: 'contact_id not found for this customer' });
      }
      const locOk = rawLocId
        ? verified.customer_location_id === rawLocId
        : verified.customer_location_id == null;
      if (!locOk) {
        return res.status(400).json({ success: false, error: 'contact_id does not belong to this scope' });
      }
      const { error: cupErr } = await supabase.from('contacts').update(payload).eq('id', rawContactId);
      if (cupErr) {
        console.error('masterlist contact update:', cupErr);
        return res.status(500).json({ success: false, error: cupErr.message });
      }
    } else if (forceNewSiteContact) {
      const insertPayload = {
        ...payload,
        tel2: null,
        email: contactEmail !== undefined ? contactEmail : null,
        tel1: contactPhone !== undefined ? contactPhone : null,
      };
      const { error: insErr } = await supabase.from('contacts').insert(insertPayload);
      if (insErr) {
        console.error('masterlist contact insert:', insErr);
        return res.status(500).json({ success: false, error: insErr.message });
      }
      contactWasInsert = true;
    } else {
      const existing = beforeContact;

      if (existing?.id) {
        const { error: cupErr } = await supabase.from('contacts').update(payload).eq('id', existing.id);
        if (cupErr) {
          console.error('masterlist contact update:', cupErr);
          return res.status(500).json({ success: false, error: cupErr.message });
        }
      } else {
        const insertPayload = {
          ...payload,
          tel2: null,
          email: contactEmail !== undefined ? contactEmail : null,
          tel1: contactPhone !== undefined ? contactPhone : null,
        };
        const { error: insErr } = await supabase.from('contacts').insert(insertPayload);
        if (insErr) {
          console.error('masterlist contact insert:', insErr);
          return res.status(500).json({ success: false, error: insErr.message });
        }
        contactWasInsert = true;
      }
    }
  }

  const { data: afterCustomer } = await supabase
    .from('customer')
    .select('id, customer_code, customer_name, phone_number, email, customer_address')
    .eq('id', customer.id)
    .maybeSingle();

  const afterCustomerSnapshot = buildCustomerSnapshot(afterCustomer || { ...customer, ...custUpdates });
  const customerChanges = buildChanges(beforeCustomerSnapshot, afterCustomerSnapshot);

  let contactChanges = null;
  if (hasContactPayload) {
    const afterContact = await fetchScopedContact(
      supabase,
      customer.id,
      rawLocId,
      rawContactId || beforeContact?.id,
    );
    const afterContactSnapshot = buildContactSnapshot(afterContact);
    contactChanges = contactWasInsert
      ? buildCreateChanges(beforeContactSnapshot, afterContactSnapshot)
      : buildChanges(beforeContactSnapshot, afterContactSnapshot);
  }

  const subAction = hasContactPayload
    ? contactWasInsert
      ? 'create_contact'
      : 'update_contact'
    : 'update_customer';

  await writeAuditLogFromRequest(req, {
    action: AUDIT_ACTIONS.CUSTOMER_UPDATE,
    category: AUDIT_CATEGORIES.CUSTOMER,
    entityType: 'customer',
    entityId: customer.id,
    entityLabel: customer.customer_name || cardCode,
    description: `Masterlist customer updated: ${cardCode}`,
    details: {
      subAction,
      customerLocationId: rawLocId,
      cardCode,
    },
    changes: mergeChanges(customerChanges, contactChanges),
    status: AUDIT_STATUS.SUCCESS,
  });

  customerCache.invalidateCustomer(cardCode);

  return res.status(200).json({ success: true, message: 'Customer masterlist updated' });
}

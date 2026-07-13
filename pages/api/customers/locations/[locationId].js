import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import customerCache from '../../../../lib/utils/customerCache';
import { siteAddressLookupKeys } from '../../../../lib/utils/siteAddressKeyAliases';
import { updatePortalServiceLocation } from '../../../../lib/customers/updatePortalServiceLocation';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
} from '../../../../lib/services/auditLog';
import {
  buildLocationDeleteSnapshot,
  diffSnapshots,
} from '../../../../utils/auditSnapshots';

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

async function handlePatch(req, res) {
  try {
    const locationId = req.query.locationId ? String(req.query.locationId).trim() : '';
    if (!locationId) {
      return res.status(400).json({ error: 'locationId is required' });
    }

    const body = jsonBody(req);
    const customerCode = String(req.query.customerCode || body.customerCode || '').trim();
    const addressName = String(body.addressName ?? '').trim();
    const addressType = body.addressType;
    const fullAddress = String(body.fullAddress ?? '').trim();

    if (!customerCode) {
      return res.status(400).json({ error: 'customerCode is required' });
    }
    if (!addressName) {
      return res.status(400).json({ error: 'addressName is required' });
    }
    if (!fullAddress) {
      return res.status(400).json({ error: 'fullAddress is required' });
    }

    const supabase = getSupabaseAdmin();
    const result = await updatePortalServiceLocation({
      supabase,
      req,
      table: 'customer_location',
      locationId,
      ownerCode: customerCode,
      ownerKind: 'customer',
      addressName,
      addressType,
      fullAddress,
    });

    customerCache.invalidateCustomer(customerCode);

    return res.status(200).json({
      success: true,
      message: 'Service location updated',
      ...result,
    });
  } catch (error) {
    console.error('Unexpected error in locations PATCH API:', error);
    const message = error?.message || 'Internal server error';
    const status =
      message.includes('not found') ? 404 : message.includes('required') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
}

export default async function handler(req, res) {
  if (req.method === 'PATCH') {
    return handlePatch(req, res);
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SAP READ-ONLY: portal service-location DELETE removes FSM `customer_location`
  // (and related portal rows) only. Do not PATCH/DELETE SAP BPAddresses.
  try {
    const locationId = req.query.locationId ? String(req.query.locationId).trim() : '';
    if (!locationId) {
      return res.status(400).json({ error: 'locationId is required' });
    }

    const body = jsonBody(req);
    const customerCode = String(req.query.customerCode || body.customerCode || '').trim();
    if (!customerCode) {
      return res.status(400).json({ error: 'customerCode is required' });
    }

    const supabase = getSupabaseAdmin();

    const { data: customer, error: custErr } = await supabase
      .from('customer')
      .select('id, customer_code')
      .eq('customer_code', customerCode)
      .is('deleted_at', null)
      .maybeSingle();

    if (custErr) {
      console.error('Error loading customer:', custErr);
      return res.status(500).json({ error: 'Failed to load customer' });
    }
    if (!customer?.id) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const { data: locationRow, error: locErr } = await supabase
      .from('customer_location')
      .select('id, site_id, address_type, location_id, building, block')
      .eq('id', locationId)
      .eq('customer_id', customer.id)
      .maybeSingle();

    if (locErr) {
      console.error('Error loading customer_location:', locErr);
      return res.status(500).json({ error: 'Failed to load service location' });
    }
    if (!locationRow?.id) {
      return res.status(404).json({ error: 'Service location not found for this customer' });
    }

    if (locationRow.location_id) {
      const { count, error: jobsErr } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('location_id', locationRow.location_id)
        .is('deleted_at', null);

      if (jobsErr) {
        console.error('Error checking jobs:', jobsErr);
        return res.status(500).json({ error: 'Failed to check linked jobs' });
      }
      if (count > 0) {
        return res.status(409).json({
          error: `Cannot delete: ${count} active job(s) reference this service location`,
          jobCount: count,
        });
      }
    }

    const now = new Date().toISOString();
    const aliasKeys = siteAddressLookupKeys(locationRow.site_id, locationRow.address_type);

    const { data: detailsByFk, error: fkErr } = await supabase
      .from('customer_address_details')
      .select('id, status, address_notes')
      .eq('customer_location_id', locationRow.id)
      .is('deleted_at', null);

    if (fkErr) {
      console.error('Error loading address details by FK:', fkErr);
      return res.status(500).json({ error: 'Failed to load address details' });
    }

    const detailIds = new Set((detailsByFk || []).map((r) => r.id));
    const primaryAddressDetail = detailsByFk?.[0] ?? null;
    const beforeSnapshot = buildLocationDeleteSnapshot(locationRow, primaryAddressDetail);

    for (const key of aliasKeys) {
      const { data: aliasRows, error: aliasErr } = await supabase
        .from('customer_address_details')
        .select('id')
        .eq('customer_code', customerCode)
        .eq('address_name', key)
        .is('deleted_at', null);

      if (aliasErr) {
        console.error('Error loading address details by alias:', aliasErr);
        return res.status(500).json({ error: 'Failed to load address details' });
      }
      for (const row of aliasRows || []) {
        if (row?.id) detailIds.add(row.id);
      }
    }

    if (detailIds.size > 0) {
      const { error: softDelErr } = await supabase
        .from('customer_address_details')
        .update({ deleted_at: now, updated_at: now })
        .in('id', [...detailIds]);

      if (softDelErr) {
        console.error('Error soft-deleting address details:', softDelErr);
        return res.status(500).json({ error: 'Failed to soft-delete address details' });
      }
    }

    const { error: contactsErr } = await supabase
      .from('contacts')
      .delete()
      .eq('customer_location_id', locationRow.id);

    if (contactsErr) {
      console.error('Error deleting site contacts:', contactsErr);
      return res.status(500).json({ error: 'Failed to delete site contacts' });
    }

    const { error: delLocErr } = await supabase
      .from('customer_location')
      .delete()
      .eq('id', locationRow.id);

    if (delLocErr) {
      console.error('Error deleting customer_location:', delLocErr);
      return res.status(500).json({ error: 'Failed to delete service location' });
    }

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.CUSTOMER_UPDATE,
      category: AUDIT_CATEGORIES.CUSTOMER,
      entityType: 'customer',
      entityId: customer.id,
      entityLabel: customer.customer_code,
      description: `Service location deleted for ${customerCode}`,
      details: {
        subAction: 'delete_location',
        locationId: locationRow.id,
        addressDetailsSoftDeleted: detailIds.size,
      },
      changes: diffSnapshots(beforeSnapshot, buildLocationDeleteSnapshot(null, null)),
      status: AUDIT_STATUS.SUCCESS,
    });

    customerCache.invalidateCustomer(customerCode);

    return res.status(200).json({
      success: true,
      message: 'Service location deleted',
      deletedLocationId: locationRow.id,
      addressDetailsSoftDeleted: detailIds.size,
    });
  } catch (error) {
    console.error('Unexpected error in locations DELETE API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}

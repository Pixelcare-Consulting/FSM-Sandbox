import { getSupabaseAdmin } from '../../../../lib/supabase/server';
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
    const leadCode = String(req.query.leadCode || body.leadCode || '').trim();
    const addressName = String(body.addressName ?? '').trim();
    const addressType = body.addressType;
    const fullAddress = String(body.fullAddress ?? '').trim();

    if (!leadCode) {
      return res.status(400).json({ error: 'leadCode is required' });
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
      table: 'sap_lead_location',
      locationId,
      ownerCode: leadCode,
      ownerKind: 'lead',
      addressName,
      addressType,
      fullAddress,
    });

    return res.status(200).json({
      success: true,
      message: 'Service location updated',
      ...result,
    });
  } catch (error) {
    console.error('Unexpected error in leads locations PATCH API:', error);
    const message = error?.message || 'Internal server error';
    const status =
      message.includes('not found') ? 404 : message.includes('required') ? 400 : 500;
    return res.status(status).json({ error: message });
  }
}

async function handleDelete(req, res) {
  try {
    const locationId = req.query.locationId ? String(req.query.locationId).trim() : '';
    if (!locationId) {
      return res.status(400).json({ error: 'locationId is required' });
    }

    const body = jsonBody(req);
    const leadCode = String(req.query.leadCode || body.leadCode || '').trim();
    if (!leadCode) {
      return res.status(400).json({ error: 'leadCode is required' });
    }

    const supabase = getSupabaseAdmin();

    const { data: lead, error: leadErr } = await supabase
      .from('sap_lead')
      .select('id, lead_code')
      .eq('lead_code', leadCode)
      .is('deleted_at', null)
      .maybeSingle();

    if (leadErr) {
      console.error('Error loading sap_lead:', leadErr);
      return res.status(500).json({ error: 'Failed to load lead' });
    }
    if (!lead?.id) {
      return res.status(404).json({ error: 'SAP lead not found in masterlist' });
    }

    const { data: locationRow, error: locErr } = await supabase
      .from('sap_lead_location')
      .select('id, site_id, address_type, location_id, building, block')
      .eq('id', locationId)
      .eq('sap_lead_id', lead.id)
      .maybeSingle();

    if (locErr) {
      console.error('Error loading sap_lead_location:', locErr);
      return res.status(500).json({ error: 'Failed to load service location' });
    }
    if (!locationRow?.id) {
      return res.status(404).json({ error: 'Service location not found for this lead' });
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
    const detailIds = new Set();
    let primaryAddressDetail = null;

    // Lead address details are keyed by customer_code (lead code) + address name only;
    // customer_location_id FK references customer_location, not sap_lead_location.
    for (const key of aliasKeys) {
      const { data: aliasRows, error: aliasErr } = await supabase
        .from('customer_address_details')
        .select('id, status, address_notes')
        .eq('customer_code', leadCode)
        .eq('address_name', key)
        .is('deleted_at', null);

      if (aliasErr) {
        console.error('Error loading address details by alias:', aliasErr);
        return res.status(500).json({ error: 'Failed to load address details' });
      }
      for (const row of aliasRows || []) {
        if (row?.id) {
          detailIds.add(row.id);
          if (!primaryAddressDetail) primaryAddressDetail = row;
        }
      }
    }

    const beforeSnapshot = buildLocationDeleteSnapshot(locationRow, primaryAddressDetail);

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
      .eq('sap_lead_location_id', locationRow.id);

    if (contactsErr) {
      console.error('Error deleting site contacts:', contactsErr);
      return res.status(500).json({ error: 'Failed to delete site contacts' });
    }

    const { error: delLocErr } = await supabase
      .from('sap_lead_location')
      .delete()
      .eq('id', locationRow.id);

    if (delLocErr) {
      console.error('Error deleting sap_lead_location:', delLocErr);
      return res.status(500).json({ error: 'Failed to delete service location' });
    }

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.LEAD_UPDATE,
      category: AUDIT_CATEGORIES.LEAD,
      entityType: 'lead',
      entityId: lead.id,
      entityLabel: lead.lead_code,
      description: `Service location deleted for ${leadCode}`,
      details: {
        subAction: 'delete_location',
        locationId: locationRow.id,
        addressDetailsSoftDeleted: detailIds.size,
      },
      changes: diffSnapshots(beforeSnapshot, buildLocationDeleteSnapshot(null, null)),
      status: AUDIT_STATUS.SUCCESS,
    });

    return res.status(200).json({
      success: true,
      message: 'Service location deleted',
      deletedLocationId: locationRow.id,
      addressDetailsSoftDeleted: detailIds.size,
    });
  } catch (error) {
    console.error('Unexpected error in leads locations DELETE API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}

export default async function handler(req, res) {
  if (req.method === 'PATCH') {
    return handlePatch(req, res);
  }

  if (req.method === 'DELETE') {
    return handleDelete(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

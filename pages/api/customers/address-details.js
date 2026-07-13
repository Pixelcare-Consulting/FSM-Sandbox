import { getSupabaseAdmin } from '../../../lib/supabase/server';
import customerCache from '../../../lib/utils/customerCache';
import {
  addressDetailsStorageName,
  siteAddressLookupKeys,
} from '../../../lib/utils/siteAddressKeyAliases';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
  buildChanges,
} from '../../../lib/services/auditLog';
import {
  buildAddressDetailsSnapshot,
  buildCreateChanges,
} from '../../../utils/auditSnapshots';

const ADDRESS_DETAILS_AUDIT_FIELDS = [
  'id',
  'address_name',
  'address_type',
  'status',
  'address_notes',
  'customer_location_id',
];

function portalLocationShortLabel(cl) {
  const site = (cl?.site_id || '').trim();
  if (site) return site;
  const block = (cl?.block || '').trim();
  const building = (cl?.building || '').trim();
  if (block && building) return `${block}${building.startsWith('#') ? building : `#${building}`}`;
  return building || '';
}

function uniqLookupKeys(keys) {
  const out = [];
  const seen = new Set();
  for (const key of keys) {
    const t = String(key ?? '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

async function resolveCustomerLocationLabel(supabase, locationId, fallbackAddressName) {
  if (!locationId) return fallbackAddressName || null;
  const { data: loc } = await supabase
    .from('customer_location')
    .select('site_id, block, building')
    .eq('id', locationId)
    .maybeSingle();
  const label = portalLocationShortLabel(loc);
  return label || fallbackAddressName || locationId;
}

async function snapshotWithLocationLabel(supabase, row, addressName) {
  if (!row) return buildAddressDetailsSnapshot(null);
  const label = await resolveCustomerLocationLabel(
    supabase,
    row.customer_location_id,
    addressName || row.address_name,
  );
  return buildAddressDetailsSnapshot({
    ...row,
    customer_location_label: label,
  });
}

async function findExistingAddressDetailsRecord(
  supabase,
  { customerCode, addressName, addressType, customerLocationId },
) {
  if (customerLocationId) {
    const { data: byFk, error: fkErr } = await supabase
      .from('customer_address_details')
      .select(ADDRESS_DETAILS_AUDIT_FIELDS.join(', '))
      .eq('customer_code', customerCode)
      .eq('customer_location_id', customerLocationId)
      .is('deleted_at', null)
      .maybeSingle();
    if (fkErr && fkErr.code !== 'PGRST116') return { row: null, error: fkErr };
    if (byFk?.id) return { row: byFk, error: null };
  }

  const canonicalName = addressDetailsStorageName(addressName, addressType);
  const lookupKeys = uniqLookupKeys([
    canonicalName,
    ...siteAddressLookupKeys(addressName, addressType),
    addressName,
  ]);

  for (const key of lookupKeys) {
    const { data: row, error } = await supabase
      .from('customer_address_details')
      .select(ADDRESS_DETAILS_AUDIT_FIELDS.join(', '))
      .eq('customer_code', customerCode)
      .eq('address_name', key)
      .is('deleted_at', null)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') return { row: null, error };
    if (row?.id) return { row, error: null };
  }

  return { row: null, error: null };
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { customerCode, addressName, addressType, status, addressNotes, customerLocationId } =
      req.body;

    if (!customerCode || !addressName) {
      return res.status(400).json({
        error: 'Missing required fields: customerCode and addressName are required',
      });
    }

    const supabase = getSupabaseAdmin();

    let resolvedAddressType = addressType;
    if (resolvedAddressType === undefined && customerLocationId) {
      const { data: clRow } = await supabase
        .from('customer_location')
        .select('address_type')
        .eq('id', customerLocationId)
        .maybeSingle();
      if (clRow?.address_type) resolvedAddressType = clRow.address_type;
    }

    const canonicalAddressName =
      addressDetailsStorageName(addressName, resolvedAddressType) || String(addressName).trim();

    const { row: existingRecord, error: fetchError } = await findExistingAddressDetailsRecord(
      supabase,
      {
        customerCode,
        addressName,
        addressType: resolvedAddressType,
        customerLocationId,
      },
    );

    if (fetchError) {
      console.error('Error checking existing record:', fetchError);
      return res.status(500).json({ error: 'Failed to check existing record' });
    }

    const dataToSave = {
      customer_code: customerCode,
      address_name: canonicalAddressName,
      updated_at: new Date().toISOString(),
    };

    if (resolvedAddressType !== undefined) dataToSave.address_type = resolvedAddressType;
    if (status !== undefined) dataToSave.status = status;
    if (addressNotes !== undefined) dataToSave.address_notes = addressNotes;
    if (customerLocationId !== undefined) dataToSave.customer_location_id = customerLocationId;

    const beforeSnapshot = await snapshotWithLocationLabel(
      supabase,
      existingRecord,
      canonicalAddressName,
    );

    const afterPreview = {
      ...(existingRecord || {}),
      address_name: canonicalAddressName,
      address_type:
        resolvedAddressType !== undefined ? resolvedAddressType : existingRecord?.address_type,
      status: status !== undefined ? status : existingRecord?.status,
      address_notes: addressNotes !== undefined ? addressNotes : existingRecord?.address_notes,
      customer_location_id:
        customerLocationId !== undefined
          ? customerLocationId
          : existingRecord?.customer_location_id,
    };
    const afterPreviewSnapshot = await snapshotWithLocationLabel(
      supabase,
      afterPreview,
      canonicalAddressName,
    );

    const previewChanges = existingRecord
      ? buildChanges(beforeSnapshot, afterPreviewSnapshot)
      : buildCreateChanges(beforeSnapshot, afterPreviewSnapshot);

    if (existingRecord && !previewChanges) {
      return res.status(200).json({
        success: true,
        message: 'No changes to save',
        data: existingRecord,
        noOp: true,
      });
    }

    let result;
    let error;

    if (existingRecord) {
      ({ data: result, error } = await supabase
        .from('customer_address_details')
        .update(dataToSave)
        .eq('id', existingRecord.id)
        .select()
        .single());
    } else {
      ({ data: result, error } = await supabase
        .from('customer_address_details')
        .insert(dataToSave)
        .select()
        .single());
    }

    if (error) {
      console.error('Error saving address details:', error);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_UPDATE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityId: customerCode,
        entityLabel: customerCode,
        description: 'Failed to save address details',
        details: {
          subAction: existingRecord ? 'update_address_details' : 'create_address_details',
          error: error.message,
        },
        status: AUDIT_STATUS.FAILURE,
      });
      return res.status(500).json({
        error: 'Failed to save address details',
        details: error.message,
      });
    }

    const afterSnapshot = await snapshotWithLocationLabel(supabase, result, canonicalAddressName);
    const changes = existingRecord
      ? buildChanges(beforeSnapshot, afterSnapshot)
      : buildCreateChanges(beforeSnapshot, afterSnapshot);

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.CUSTOMER_UPDATE,
      category: AUDIT_CATEGORIES.CUSTOMER,
      entityType: 'customer',
      entityId: customerCode,
      entityLabel: customerCode,
      description: existingRecord ? 'Address details updated' : 'Address details created',
      details: {
        subAction: existingRecord ? 'update_address_details' : 'create_address_details',
      },
      changes,
      status: AUDIT_STATUS.SUCCESS,
    });

    customerCache.invalidateCustomer(customerCode);

    return res.status(200).json({
      success: true,
      message: existingRecord
        ? 'Address details updated successfully'
        : 'Address details created successfully',
      data: result,
    });
  } catch (error) {
    console.error('Unexpected error in address-details API:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}

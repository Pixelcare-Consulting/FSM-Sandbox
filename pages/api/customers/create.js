/**
 * API endpoint to create a new Customer in Supabase (generic/portal only).
 * No direct SAP creation - use Portal Customers → Convert to SAP for L codes.
 * POST /api/customers/create
 */

import { validateBusinessPartnerData } from '../../../lib/utils/sapBusinessPartnerTransform';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { customerService } from '../../../lib/supabase/database';
import { findPortalDuplicate } from '../../../lib/customers/portalDuplicateCheck';
import { mapCreatePayloadToCustomerFields } from '../../../lib/customers/portalCustomerFieldMap';
import { ensurePortalCustomerFromCreatePayload } from '../../../lib/customers/ensurePortalCustomerFromCreatePayload';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
} from '../../../lib/services/auditLog';
import { invalidateListCache } from '../../../lib/supabase/listQueryHelpers';
import { PORTAL_LIST_CACHE_PREFIX } from '../../../lib/leads/portalListCache';

function validateCreateCustomerPayload(body) {
  const errors = [];

  if (!body.CardName || String(body.CardName).trim() === '') {
    errors.push('CardName is required');
  }
  if (body.CardName && body.CardName.length > 100) {
    errors.push('CardName must be at most 100 characters');
  }

  if (!body.BPAddresses || !Array.isArray(body.BPAddresses) || body.BPAddresses.length === 0) {
    errors.push('At least one BPAddress is required');
  } else {
    const hasBillTo = body.BPAddresses.some((a) => a.AddressType === 'bo_BillTo');
    const hasShipTo = body.BPAddresses.some((a) => a.AddressType === 'bo_ShipTo');
    if (!hasBillTo) errors.push('At least one address must have AddressType bo_BillTo');
    if (!hasShipTo) errors.push('At least one address must have AddressType bo_ShipTo');
  }

  return { isValid: errors.length === 0, errors };
}

function buildSAPPayload(body) {
  const payload = {
    Series: 71,
    CardName: body.CardName ? String(body.CardName).trim() : '',
    CardType: 'cLid',
    Valid: 'tYES',
    Frozen: 'tNO',
  };

  if (body.Phone1 != null) payload.Phone1 = String(body.Phone1);
  if (body.Phone2 != null) payload.Phone2 = body.Phone2;
  if (body.EmailAddress != null) payload.EmailAddress = body.EmailAddress;
  if (body.FreeText != null) payload.FreeText = body.FreeText;
  if (body.Block != null) payload.Block = body.Block;
  if (body.Unit != null) payload.Unit = body.Unit;

  if (body.BPAddresses && Array.isArray(body.BPAddresses) && body.BPAddresses.length > 0) {
    payload.BPAddresses = body.BPAddresses.map((addr) => {
      const a = {
        AddressName: addr.AddressName || '',
        Street: addr.Street || null,
        BuildingFloorRoom: addr.BuildingFloorRoom || null,
        Country: addr.Country || 'SG',
        State: addr.State != null ? addr.State : 'SG',
        ZipCode: addr.ZipCode || null,
        AddressType: addr.AddressType || 'bo_BillTo',
      };
      if (addr.AddressName2 != null) a.AddressName2 = addr.AddressName2;
      if (addr.AddressName3 != null) a.AddressName3 = addr.AddressName3;
      if (addr.StreetNo != null) a.StreetNo = addr.StreetNo;
      if (addr.Block != null) a.Block = addr.Block;
      if (addr.City != null) a.City = addr.City;
      if (addr.U_Remarks != null) a.U_Remarks = addr.U_Remarks;
      return a;
    });
  }

  if (body.ContactEmployees && Array.isArray(body.ContactEmployees) && body.ContactEmployees.length > 0) {
    payload.ContactEmployees = body.ContactEmployees.map((ce) => ({
      Name: ce.Name || '',
      FirstName: ce.FirstName != null ? ce.FirstName : '',
      LastName: ce.LastName != null ? ce.LastName : '',
      Position: ce.Position,
      Phone1: ce.Phone1,
      Phone2: ce.Phone2,
      MobilePhone: ce.MobilePhone,
      Fax: ce.Fax,
      E_Mail: ce.E_Mail,
      MiddleName: ce.MiddleName,
    }));
  }

  return payload;
}

async function getNextPortalCardCode(supabase) {
  const { customerService: svc } = require('../../../lib/supabase/database');
  return svc.getNextPortalCardCode(supabase);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database unavailable', message: 'Please try again later.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  const validation = validateCreateCustomerPayload(body);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: validation.errors,
    });
  }

  const sapPayload = buildSAPPayload(body);
  const bpValidation = validateBusinessPartnerData(sapPayload);
  if (!bpValidation.isValid) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      errors: bpValidation.errors,
    });
  }

  try {
    const duplicate = await findPortalDuplicate(supabase, {
      email: sapPayload.EmailAddress,
      phone: sapPayload.Phone1 || sapPayload.Phone2,
    });
    if (duplicate?.existingCode) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate contact',
        message: `A portal record already exists for this email or phone (${duplicate.existingCode}).`,
        existingCode: duplicate.existingCode,
        existingType: duplicate.existingType,
        suggestion: duplicate.suggestion,
      });
    }
  } catch (dupErr) {
    console.error('Duplicate check error:', dupErr);
    return res.status(500).json({
      success: false,
      error: 'Failed to verify duplicate contact',
      message: dupErr.message || 'Please try again.',
    });
  }

  let customerCode;
  try {
    customerCode = await getNextPortalCardCode(supabase);
  } catch (err) {
    console.error('Get next portal card code error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate customer code',
      message: err.message || 'Please try again.',
    });
  }

  const customerData = mapCreatePayloadToCustomerFields(sapPayload, customerCode);

  async function finalizeCreate(created) {
    try {
      await ensurePortalCustomerFromCreatePayload({
        supabase,
        customerId: created.id,
        payload: sapPayload,
      });
    } catch (persistErr) {
      console.warn('Create customer: address/contact persist failed:', persistErr?.message);
    }

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.CUSTOMER_CREATE,
      category: AUDIT_CATEGORIES.CUSTOMER,
      entityType: 'customer',
      entityId: created.id,
      entityLabel: created.customer_name || created.customer_code,
      description: `Customer created: ${created.customer_code}`,
      details: { customerCode: created.customer_code, source: 'portal' },
      status: AUDIT_STATUS.SUCCESS,
    });

    invalidateListCache(PORTAL_LIST_CACHE_PREFIX);

    return res.status(200).json({
      success: true,
      message: 'Customer created successfully (saved in portal).',
      cardCode: created.customer_code,
      customer: created,
    });
  }

  try {
    const created = await customerService.create(customerData, supabase);
    return finalizeCreate(created);
  } catch (err) {
    if (err.code === '23505') {
      try {
        customerCode = await getNextPortalCardCode(supabase);
        const retryData = mapCreatePayloadToCustomerFields(sapPayload, customerCode);
        const created = await customerService.create(retryData, supabase);
        return finalizeCreate(created);
      } catch (retryErr) {
        console.error('Create customer (portal) retry error:', retryErr);
        return res.status(500).json({
          success: false,
          error: 'Failed to create customer',
          message: retryErr.message || 'Please try again.',
        });
      }
    }
    console.error('Create customer (portal) error:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to create customer',
      message: err.message || 'Please try again.',
    });
  }
}

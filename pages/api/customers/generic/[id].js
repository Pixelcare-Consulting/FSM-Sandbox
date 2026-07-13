/**
 * Generic customer by ID - update and delete
 * PATCH: update generic customer (only if source = 'portal')
 * DELETE: soft-delete generic customer
 */

import { customerService } from '../../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
  buildChanges,
} from '../../../../lib/services/auditLog';
import { invalidateListCache } from '../../../../lib/supabase/listQueryHelpers';
import { PORTAL_LIST_CACHE_PREFIX } from '../../../../lib/leads/portalListCache';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Accept');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ success: false, error: 'Customer ID required' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database unavailable' });
  }

  // Ensure customer exists and is generic (portal)
  let existing;
  try {
    existing = await customerService.findById(id, supabase);
  } catch (e) {
    return res.status(404).json({ success: false, error: 'Customer not found' });
  }
  if (!existing || !existing.id) {
    return res.status(404).json({ success: false, error: 'Customer not found' });
  }
  if (existing.source !== 'portal') {
    return res.status(403).json({ success: false, error: 'Only generic (portal) customers can be updated or deleted here' });
  }

  if (req.method === 'PATCH') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }

    const updates = {};
    if (body.customer_name !== undefined) updates.customer_name = String(body.customer_name).trim();
    if (body.customer_address !== undefined) updates.customer_address = body.customer_address;
    if (body.phone_number !== undefined) updates.phone_number = body.phone_number;
    if (body.email !== undefined) updates.email = body.email;
    if (body.customer_code !== undefined) updates.customer_code = String(body.customer_code).trim();
    if (body.block !== undefined) updates.block = body.block == null || body.block === '' ? null : String(body.block).trim();
    if (body.unit !== undefined) updates.unit = body.unit == null || body.unit === '' ? null : String(body.unit).trim();
    if (body.notes !== undefined) updates.notes = body.notes == null || body.notes === '' ? null : String(body.notes).trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    try {
      const customer = await customerService.update(id, updates, supabase);
      invalidateListCache(PORTAL_LIST_CACHE_PREFIX);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_UPDATE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityId: id,
        entityLabel: customer.customer_name || customer.customer_code,
        description: `Generic customer updated: ${customer.customer_code}`,
        details: { customerCode: customer.customer_code, source: 'portal' },
        changes: buildChanges(existing, customer),
        status: AUDIT_STATUS.SUCCESS,
      });
      return res.status(200).json({ success: true, customer });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ success: false, error: 'Customer code already in use' });
      }
      console.error('Generic customer update error:', err);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_UPDATE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityId: id,
        entityLabel: existing.customer_name || existing.customer_code,
        description: 'Failed to update generic customer',
        details: { error: err.message },
        status: AUDIT_STATUS.FAILURE,
      });
      return res.status(500).json({ success: false, error: err.message || 'Update failed' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      await customerService.delete(id, supabase);
      invalidateListCache(PORTAL_LIST_CACHE_PREFIX);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_DELETE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityId: id,
        entityLabel: existing.customer_name || existing.customer_code,
        description: `Generic customer deleted: ${existing.customer_code}`,
        details: { customerCode: existing.customer_code, source: 'portal' },
        status: AUDIT_STATUS.SUCCESS,
      });
      return res.status(200).json({ success: true, message: 'Customer deleted' });
    } catch (err) {
      console.error('Generic customer delete error:', err);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_DELETE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityId: id,
        entityLabel: existing.customer_name || existing.customer_code,
        description: 'Failed to delete generic customer',
        details: { error: err.message },
        status: AUDIT_STATUS.FAILURE,
      });
      return res.status(500).json({ success: false, error: err.message || 'Delete failed' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

/**
 * Generic (portal) customers API - list and create
 * GET: list customers with source = 'portal'
 * POST: create new generic customer in Supabase (no SAP)
 */

import { customerService } from '../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import {
  getListCache,
  setListCache,
  invalidateListCache,
} from '../../../lib/supabase/listQueryHelpers';
import {
  PORTAL_LIST_CACHE_PREFIX,
  PORTAL_LIST_CACHE_TTL_MS,
} from '../../../lib/leads/portalListCache';
import {
  writeAuditLogFromRequest,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
} from '../../../lib/services/auditLog';

function generateCustomerCode() {
  const prefix = 'GEN';
  const num = Date.now().toString(36).toUpperCase().slice(-6);
  return `${prefix}-${num}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With, Accept');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ success: false, error: 'Database unavailable' });
  }

  if (req.method === 'GET') {
    try {
      const cacheKey = `${PORTAL_LIST_CACHE_PREFIX}generic`;
      const cached = getListCache(cacheKey, PORTAL_LIST_CACHE_TTL_MS);
      if (cached) {
        return res.status(200).json(cached);
      }

      const customers = await customerService.getGenericCustomers(supabase);
      const payload = { success: true, customers };
      setListCache(cacheKey, payload, PORTAL_LIST_CACHE_TTL_MS);
      return res.status(200).json(payload);
    } catch (err) {
      console.error('Portal customers list error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to list customers' });
    }
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }

    const customerName = (body.customer_name || body.customerName || '').trim();
    if (!customerName) {
      return res.status(400).json({ success: false, error: 'customer_name is required' });
    }

    const customerCode = (body.customer_code || body.customerCode || generateCustomerCode()).trim();
    const customerData = {
      customer_code: customerCode,
      customer_name: customerName,
      customer_address: body.customer_address || body.customerAddress || null,
      phone_number: body.phone_number || body.phoneNumber || null,
      email: body.email || null,
      source: 'portal'
    };

    try {
      const customer = await customerService.create(customerData, supabase);
      invalidateListCache(PORTAL_LIST_CACHE_PREFIX);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_CREATE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityId: customer.id,
        entityLabel: customer.customer_name || customer.customer_code,
        description: `Generic customer created: ${customer.customer_code}`,
        details: { customerCode: customer.customer_code, source: 'portal' },
        status: AUDIT_STATUS.SUCCESS,
      });
      return res.status(201).json({ success: true, customer });
    } catch (err) {
      if (err.code === '23505') {
        await writeAuditLogFromRequest(req, {
          action: AUDIT_ACTIONS.CUSTOMER_CREATE,
          category: AUDIT_CATEGORIES.CUSTOMER,
          entityType: 'customer',
          entityLabel: customerCode,
          description: 'Customer code already exists',
          details: { customerCode, error: err.message },
          status: AUDIT_STATUS.FAILURE,
        });
        return res.status(409).json({ success: false, error: 'Customer code already exists' });
      }
      console.error('Generic customer create error:', err);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_CREATE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityLabel: customerCode,
        description: 'Failed to create generic customer',
        details: { customerCode, error: err.message },
        status: AUDIT_STATUS.FAILURE,
      });
      return res.status(500).json({ success: false, error: err.message || 'Failed to create customer' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

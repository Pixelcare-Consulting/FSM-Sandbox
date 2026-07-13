/**
 * API endpoint for leads CRUD operations
 * GET /api/leads - List all leads with optional filters
 * POST /api/leads - Create a new lead
 */

import { leadService } from '../../../lib/supabase/database';
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

export default async function handler(req, res) {
  // JSON list must not be cached — browsers treat 304 as !ok and may ship an empty body
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'GET') {
      // GET /api/leads - List all leads
      const { status, source, email, search, limit, offset } = req.query;
      
      const filters = {};
      if (status) filters.status = status;
      if (source) filters.source = source;
      if (email) filters.email = email;
      if (search) filters.search = search;

      // Add pagination to prevent huge responses
      const limitNum = limit ? parseInt(limit, 10) : 1000;
      const offsetNum = offset ? parseInt(offset, 10) : 0;

      const cacheKey = `${PORTAL_LIST_CACHE_PREFIX}leads:${JSON.stringify({
        status: status || null,
        source: source || null,
        email: email || null,
        search: search || null,
        limitNum,
        offsetNum,
      })}`;
      const cached = getListCache(cacheKey, PORTAL_LIST_CACHE_TTL_MS);
      if (cached) {
        return res.status(200).json(cached);
      }

      const leads = await leadService.getAll(filters, null, limitNum, offsetNum);

      const payload = {
        leads,
        total: leads.length,
        limit: limitNum,
        offset: offsetNum,
      };
      setListCache(cacheKey, payload, PORTAL_LIST_CACHE_TTL_MS);

      return res.status(200).json(payload);
    }

    if (req.method === 'POST') {
      // POST /api/leads - Create a new lead
      const leadData = req.body;

      // Validate required fields
      if (!leadData.email || !leadData.full_name) {
        return res.status(400).json({
          error: 'Email and full_name are required'
        });
      }

      // Transform data from frontend format to database format
      const dbLeadData = {
        email: leadData.email,
        full_name: leadData.fullName || leadData.full_name,
        salutation: leadData.salutation || null,
        handphone: leadData.handphone || null,
        block: leadData.block || null,
        unit: leadData.unit || null,
        address: leadData.address || null,
        first_service_date: leadData.firstServiceDate || leadData.first_service_date || null,
        second_service_date: leadData.secondServiceDate || leadData.second_service_date || null,
        third_service_date: leadData.thirdServiceDate || leadData.third_service_date || null,
        fourth_service_date: leadData.fourthServiceDate || leadData.fourth_service_date || null,
        time_slot: leadData.timeSlot || leadData.time_slot || null,
        agreed_to_terms: leadData.agreedToTerms || leadData.agreed_to_terms || false,
        personal_info_consent: leadData.personalInfoConsent || leadData.personal_info_consent || false,
        status: leadData.status || 'PENDING',
        source: leadData.source || 'GOOGLE_FORM',
        notes: leadData.notes || null,
        submitted_at: leadData.timestamp || leadData.submitted_at || new Date().toISOString()
      };

      const lead = await leadService.create(dbLeadData);

      invalidateListCache(PORTAL_LIST_CACHE_PREFIX);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.LEAD_CREATE,
        category: AUDIT_CATEGORIES.LEAD,
        entityType: 'lead',
        entityId: lead.id,
        entityLabel: lead.full_name || lead.email,
        description: `Lead created: ${lead.full_name || lead.email}`,
        details: { email: lead.email, source: lead.source, status: lead.status },
        status: AUDIT_STATUS.SUCCESS,
      });

      return res.status(201).json({
        success: true,
        lead
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in leads API:', error);
    // Only send safe error information to prevent large payloads
    const errorMessage = error?.message || 'An unexpected error occurred';
    // Limit error message length to prevent huge payloads
    const safeMessage = errorMessage.length > 500 
      ? errorMessage.substring(0, 500) + '...' 
      : errorMessage;
    
    return res.status(500).json({
      error: 'Internal server error',
      message: safeMessage
    });
  }
}


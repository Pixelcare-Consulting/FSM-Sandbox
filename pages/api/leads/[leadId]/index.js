/**
 * API endpoint for individual lead operations
 * GET /api/leads/[leadId] - Get a single lead
 * PUT /api/leads/[leadId] - Update a lead
 * DELETE /api/leads/[leadId] - Delete a lead (soft delete)
 */

import { leadService, customerService } from '../../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { ensurePortalCustomerAddressFromLead } from '../../../../lib/customers/ensurePortalCustomerAddressFromLead';
import { getEffectiveLeadName } from '../../../../lib/leads/getEffectiveLeadName';
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
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { leadId } = req.query;

  if (!leadId) {
    return res.status(400).json({ error: 'Lead ID is required' });
  }

  try {
    if (req.method === 'GET') {
      const lead = await leadService.findById(leadId);

      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      return res.status(200).json({ lead });
    }

    if (req.method === 'PUT') {
      const updateData = req.body;
      const previousLead = await leadService.findById(leadId);

      const dbUpdateData = {};

      if (updateData.email !== undefined) dbUpdateData.email = updateData.email;
      if (updateData.firstName !== undefined || updateData.first_name !== undefined) {
        dbUpdateData.first_name = updateData.firstName || updateData.first_name;
      }
      if (updateData.lastName !== undefined || updateData.last_name !== undefined) {
        dbUpdateData.last_name = updateData.lastName || updateData.last_name;
      }
      if (updateData.fullName !== undefined || updateData.full_name !== undefined) {
        dbUpdateData.full_name = updateData.fullName || updateData.full_name;
      }
      if (updateData.salutation !== undefined) dbUpdateData.salutation = updateData.salutation;
      if (updateData.handphone !== undefined) dbUpdateData.handphone = updateData.handphone;
      if (updateData.block !== undefined) dbUpdateData.block = updateData.block;
      if (updateData.unit !== undefined) dbUpdateData.unit = updateData.unit;
      if (updateData.building !== undefined) dbUpdateData.building = updateData.building;
      if (updateData.street !== undefined) dbUpdateData.street = updateData.street;
      if (updateData.postcode !== undefined) dbUpdateData.postcode = updateData.postcode;
      if (updateData.country !== undefined) dbUpdateData.country = updateData.country;
      if (updateData.address !== undefined) dbUpdateData.address = updateData.address;
      if (updateData.firstServiceDate !== undefined || updateData.first_service_date !== undefined) {
        dbUpdateData.first_service_date = updateData.firstServiceDate || updateData.first_service_date;
      }
      if (updateData.secondServiceDate !== undefined || updateData.second_service_date !== undefined) {
        dbUpdateData.second_service_date = updateData.secondServiceDate || updateData.second_service_date;
      }
      if (updateData.thirdServiceDate !== undefined || updateData.third_service_date !== undefined) {
        dbUpdateData.third_service_date = updateData.thirdServiceDate || updateData.third_service_date;
      }
      if (updateData.fourthServiceDate !== undefined || updateData.fourth_service_date !== undefined) {
        dbUpdateData.fourth_service_date = updateData.fourthServiceDate || updateData.fourth_service_date;
      }
      if (updateData.timeSlot !== undefined || updateData.time_slot !== undefined) {
        dbUpdateData.time_slot = updateData.timeSlot || updateData.time_slot;
      }
      if (updateData.agreedToTerms !== undefined || updateData.agreed_to_terms !== undefined) {
        dbUpdateData.agreed_to_terms = updateData.agreedToTerms || updateData.agreed_to_terms;
      }
      if (updateData.personalInfoConsent !== undefined || updateData.personal_info_consent !== undefined) {
        dbUpdateData.personal_info_consent = updateData.personalInfoConsent || updateData.personal_info_consent;
      }
      if (updateData.status !== undefined) dbUpdateData.status = updateData.status;
      if (updateData.source !== undefined) dbUpdateData.source = updateData.source;
      if (updateData.notes !== undefined) dbUpdateData.notes = updateData.notes;
      if (updateData.customerId !== undefined || updateData.customer_id !== undefined) {
        dbUpdateData.customer_id = updateData.customerId || updateData.customer_id;
      }

      const lead = await leadService.update(leadId, dbUpdateData);

      const customerId = lead?.customer_id || previousLead?.customer_id;
      if (customerId) {
        const supabase = getSupabaseAdmin();
        try {
          await customerService.update(
            customerId,
            {
              customer_name: getEffectiveLeadName(lead),
              phone_number: lead.handphone || null,
              email: lead.email || null,
              block: lead.block ?? null,
              unit: lead.unit ?? null,
            },
            supabase
          );
        } catch (custErr) {
          console.warn('Lead save: failed to sync customer fields from lead:', custErr?.message);
        }
        try {
          await ensurePortalCustomerAddressFromLead({
            supabase,
            customerId,
            lead
          });
        } catch (addrErr) {
          console.warn('Lead save: failed to sync address to customer:', addrErr?.message);
        }
      }

      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.LEAD_UPDATE,
        category: AUDIT_CATEGORIES.LEAD,
        entityType: 'lead',
        entityId: leadId,
        entityLabel: lead?.full_name || lead?.email || leadId,
        description: `Lead updated: ${lead?.full_name || lead?.email || leadId}`,
        details: {
          status: lead?.status,
        },
        changes: buildChanges(previousLead, lead),
        status: AUDIT_STATUS.SUCCESS,
      });

      invalidateListCache(PORTAL_LIST_CACHE_PREFIX);

      return res.status(200).json({
        success: true,
        lead,
      });
    }

    if (req.method === 'DELETE') {
      const leadToDelete = await leadService.findById(leadId);
      await leadService.delete(leadId);

      invalidateListCache(PORTAL_LIST_CACHE_PREFIX);

      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.LEAD_DELETE,
        category: AUDIT_CATEGORIES.LEAD,
        entityType: 'lead',
        entityId: leadId,
        entityLabel: leadToDelete?.full_name || leadToDelete?.email || leadId,
        description: `Lead deleted: ${leadToDelete?.full_name || leadToDelete?.email || leadId}`,
        details: { email: leadToDelete?.email },
        status: AUDIT_STATUS.SUCCESS,
      });

      return res.status(200).json({
        success: true,
        message: 'Lead deleted successfully'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error in leads API:', error);

    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Lead not found' });
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

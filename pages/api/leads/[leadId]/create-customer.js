/**
 * POST /api/leads/[leadId]/create-customer - Create customer from lead and sync to SAP
 */

import { leadService, customerService } from '../../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import sapService from '../../../../lib/services/sapService';
import { getCustomerAddressFromLead } from '../../../../lib/utils/leadLocationName';
import {
  writeAuditLogFromRequest,
  writeSapCustomerSyncAuditFromRequest,
  formatSapCustomerSyncAuditDescription,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_STATUS,
} from '../../../../lib/services/auditLog';
import { verifyCustomerSapStatus } from '../../../../lib/customers/verifySapCustomerSync';
import { syncCustomerToSapCore } from '../../../../lib/customers/syncCustomerToSapCore';
import { ensurePortalCustomerAddressFromLead } from '../../../../lib/customers/ensurePortalCustomerAddressFromLead';
import { getEffectiveLeadName } from '../../../../lib/leads/getEffectiveLeadName';
import { resolveLeadOrPortalCustomer } from '../../../../lib/leads/resolveLeadOrPortalCustomer';

function buildSapApiPayload(syncResult) {
  if (!syncResult) return { success: false };
  return {
    success: syncResult.success,
    cardCode: syncResult.sapCardCode || null,
    cardType: syncResult.cardType || (syncResult.sapCardCode?.startsWith('L') ? 'L' : null),
    action: syncResult.action,
    businessPartner: syncResult.businessPartner || null,
    masterlistSynced: syncResult.masterlistSynced ?? false,
    masterlistWarning: syncResult.masterlistWarning || null,
    verification: syncResult.verification || null,
    error: syncResult.error || null,
  };
}

async function fetchCustomerSummary(supabase, customerId) {
  const { data } = await supabase
    .from('customer')
    .select('id, customer_code, customer_name, email, phone_number, sap_card_code, synced_to_sap_at')
    .eq('id', customerId)
    .is('deleted_at', null)
    .maybeSingle();
  return data;
}

async function clearCustomerSapSyncMarkers(supabase, customerId) {
  await supabase
    .from('customer')
    .update({
      synced_to_sap_at: null,
      sap_card_code: null,
      sap_sync_verified_at: null,
      sap_sync_environment: null,
    })
    .eq('id', customerId);
}

async function refreshCustomerFromLead(supabase, customer, lead) {
  const effectiveName = getEffectiveLeadName(lead);
  const patch = {
    customer_name: effectiveName,
    phone_number: lead.handphone || null,
    email: lead.email || null,
    block: lead.block ?? null,
    unit: lead.unit ?? null,
  };
  const refreshed = await customerService.update(customer.id, patch, supabase);
  return refreshed || { ...customer, ...patch };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { leadId } = req.query;

  if (!leadId) {
    return res.status(400).json({ error: 'Lead ID is required' });
  }

  try {
    const resolved = await resolveLeadOrPortalCustomer(leadId);
    if (!resolved) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { lead, customer: resolvedCustomer, hasLinkedLead } = resolved;
    const realLeadId = hasLinkedLead ? lead.id : null;

    const sessionCookies = sapService.getSessionCookies(req);
    if (!sessionCookies) {
      return res.status(401).json({
        success: false,
        error: 'SAP session expired or invalid',
        message: 'Please log in to SAP first, then try Convert to SAP again.',
      });
    }

    if (lead.customer_id) {
      const supabase = getSupabaseAdmin();
      let existingCustomerRow = resolvedCustomer;
      if (!existingCustomerRow && lead.customer_id) {
        const { data } = await supabase
          .from('customer')
          .select(
            'id, customer_code, customer_name, email, phone_number, synced_to_sap_at, sap_card_code, sap_sync_environment'
          )
          .eq('id', lead.customer_id)
          .is('deleted_at', null)
          .maybeSingle();
        existingCustomerRow = data;
      }

      if (existingCustomerRow && lead.status === 'CONVERTED' && existingCustomerRow.synced_to_sap_at) {
        const sapStatus = await verifyCustomerSapStatus(existingCustomerRow, sessionCookies, { supabase });
        if (sapStatus.inSap && !sapStatus.needsResync) {
          return res.status(200).json({
            success: true,
            message: 'Lead already converted to customer',
            customer: existingCustomerRow,
            lead,
          });
        }
      }

      if (existingCustomerRow) {
        try {
          const existingCustomer = await refreshCustomerFromLead(
            supabase,
            existingCustomerRow,
            lead
          );

          if (existingCustomer.synced_to_sap_at) {
            await clearCustomerSapSyncMarkers(supabase, existingCustomer.id);
          }

          const syncResult = await syncCustomerToSapCore({
            customer: { ...existingCustomer, synced_to_sap_at: null, sap_card_code: null },
            lead,
            sessionCookies,
            supabase,
            req,
            preferLeadType: true,
          });

          if (!syncResult.success) {
            const statusCode = syncResult.validationErrors ? 400 : 502;
            return res.status(statusCode).json({
              success: false,
              error: syncResult.error || 'Failed to sync lead to SAP',
              message: syncResult.error,
              errors: syncResult.validationErrors,
            });
          }

          const sapCardCode = syncResult.sapCardCode;
          if (realLeadId) {
            await leadService.convertToCustomer(realLeadId, lead.customer_id);
          }
          const updatedLead = realLeadId ? await leadService.findById(realLeadId) : lead;

          await writeAuditLogFromRequest(req, {
            action: AUDIT_ACTIONS.LEAD_CONVERT,
            category: AUDIT_CATEGORIES.LEAD,
            entityType: 'lead',
            entityId: leadId,
            entityLabel: lead.full_name || lead.email || leadId,
            description: `Lead converted to customer ${existingCustomer.customer_code}`,
            details: {
              customerId: existingCustomer.id,
              customerCode: existingCustomer.customer_code,
              sapCardCode,
              action: syncResult.action,
            },
            status: AUDIT_STATUS.SUCCESS,
          });

          const customerSummary = await fetchCustomerSummary(supabase, existingCustomer.id);

          return res.status(200).json({
            success: true,
            message: 'Lead synced to SAP and marked CONVERTED',
            customer: customerSummary || {
              id: existingCustomer.id,
              customer_code: existingCustomer.customer_code,
              customer_name: existingCustomer.customer_name,
              email: existingCustomer.email,
              phone_number: existingCustomer.phone_number,
              sap_card_code: sapCardCode,
            },
            lead: updatedLead,
            sap: buildSapApiPayload(syncResult),
          });
        } catch (syncErr) {
          console.error('SAP sync error for lead', leadId, syncErr.message);
          await writeSapCustomerSyncAuditFromRequest(req, {
            entityType: 'customer',
            entityId: existingCustomerRow.id,
            entityLabel: existingCustomerRow.customer_name || existingCustomerRow.customer_code,
            description: formatSapCustomerSyncAuditDescription({
              customerName: existingCustomerRow.customer_name,
              cardCode: existingCustomerRow.customer_code,
              error: syncErr.message,
            }),
            details: { leadId, error: syncErr.message },
            status: AUDIT_STATUS.FAILURE,
          });
          return res.status(502).json({
            success: false,
            error: 'Failed to sync lead to SAP',
            message: syncErr.message,
          });
        }
      }
    }

    const supabase = getSupabaseAdmin();

    let customerCode;
    try {
      customerCode = await customerService.getNextPortalCardCode(supabase);
    } catch (err) {
      console.error('Get next portal card code error:', err);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate customer code',
        message: err.message || 'Please try again.',
      });
    }

    let existingCustomer = null;
    if (lead.email) {
      try {
        const { data } = await supabase
          .from('customer')
          .select('id, customer_code, customer_name, email, phone_number')
          .eq('email', lead.email)
          .is('deleted_at', null)
          .maybeSingle();
        existingCustomer = data;
      } catch (emailQueryError) {
        console.warn('Could not query customer by email, will create new customer:', emailQueryError.message);
      }
    }

    let customer;
    let customerId;

    if (existingCustomer) {
      customerId = existingCustomer.id;
      customer = await refreshCustomerFromLead(supabase, existingCustomer, lead);
      console.log(`ℹ️ Using existing customer: ${existingCustomer.customer_code}`);
    } else {
      const customerName = getEffectiveLeadName(lead);

      const customerData = {
        customer_code: customerCode,
        customer_name: customerName,
        customer_address: getCustomerAddressFromLead(lead),
        phone_number: lead.handphone || null,
        email: lead.email || null,
        source: 'portal',
        block: lead.block ?? null,
        unit: lead.unit ?? null,
        lead_id: leadId,
      };

      customer = await customerService.create(customerData, supabase);
      customerId = customer.id;
      console.log(`✅ Created new customer: ${customer.customer_code}`);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.CUSTOMER_CREATE,
        category: AUDIT_CATEGORIES.CUSTOMER,
        entityType: 'customer',
        entityId: customer.id,
        entityLabel: customer.customer_name || customer.customer_code,
        description: `Customer created from lead: ${customer.customer_code}`,
        details: { leadId, customerCode: customer.customer_code, source: 'lead_convert' },
        status: AUDIT_STATUS.SUCCESS,
      });
    }

    const syncResult = await syncCustomerToSapCore({
      customer,
      lead,
      sessionCookies,
      supabase,
      req,
      preferLeadType: true,
    });

    if (!syncResult.success) {
      const statusCode = syncResult.validationErrors ? 400 : 502;
      return res.status(statusCode).json({
        success: false,
        error: syncResult.error || 'Failed to sync customer to SAP',
        message: syncResult.error,
        errors: syncResult.validationErrors,
      });
    }

    if (!lead.customer_id && realLeadId) {
      await leadService.convertToCustomer(realLeadId, customerId);
      console.log(`✅ Linked lead ${realLeadId} to customer ${customerId}`);
      await writeAuditLogFromRequest(req, {
        action: AUDIT_ACTIONS.LEAD_CONVERT,
        category: AUDIT_CATEGORIES.LEAD,
        entityType: 'lead',
        entityId: leadId,
        entityLabel: lead.full_name || lead.email || leadId,
        description: `Lead converted to customer ${customer.customer_code}`,
        details: { customerId, customerCode: customer.customer_code, sapCardCode: syncResult.sapCardCode },
        status: AUDIT_STATUS.SUCCESS,
      });
    }

    const updatedLead = realLeadId ? await leadService.findById(realLeadId) : lead;
    try {
      await ensurePortalCustomerAddressFromLead({
        supabase,
        customerId: customer.id,
        lead: updatedLead || lead,
      });
    } catch (addrErr) {
      console.warn('create-customer: address sync failed:', addrErr?.message);
    }

    const customerSummary = await fetchCustomerSummary(supabase, customer.id);

    return res.status(200).json({
      success: true,
      message: 'Customer created successfully',
      customer: customerSummary || {
        id: customer.id,
        customer_code: customer.customer_code,
        customer_name: customer.customer_name,
        email: customer.email,
        phone_number: customer.phone_number,
        sap_card_code: syncResult.sapCardCode,
      },
      lead: updatedLead,
      sap: buildSapApiPayload(syncResult),
    });
  } catch (error) {
    console.error('Error creating customer from lead:', error);

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

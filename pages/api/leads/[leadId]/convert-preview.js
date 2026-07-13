/**
 * POST /api/leads/[leadId]/convert-preview — dry-run preview before Convert to SAP
 */

import { customerService } from '../../../../lib/supabase/database';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import sapService from '../../../../lib/services/sapService';
import { getCustomerAddressFromLead } from '../../../../lib/utils/leadLocationName';
import {
  transformToSAPBusinessPartner,
  validateBusinessPartnerData,
} from '../../../../lib/utils/sapBusinessPartnerTransform';
import {
  getEffectiveSapCardCode,
  tryLinkExistingSapLeadPartner,
} from '../../../../lib/customers/sapCustomerLinkHelpers';
import { verifyCustomerSapStatus } from '../../../../lib/customers/verifySapCustomerSync';
import { getCurrentSapSyncEnvironment } from '../../../../lib/customers/sapSyncEnvironment';
import { getEffectiveLeadName } from '../../../../lib/leads/getEffectiveLeadName';
import {
  findSiblingPortalCustomers,
} from '../../../../lib/customers/portalDuplicateCheck';
import { resolveLeadOrPortalCustomer } from '../../../../lib/leads/resolveLeadOrPortalCustomer';

function collectServiceDates(lead) {
  return [
    { label: 'First Service', value: lead.first_service_date },
    { label: 'Second Service', value: lead.second_service_date },
    { label: 'Third Service', value: lead.third_service_date },
    { label: 'Fourth Service', value: lead.fourth_service_date },
  ].filter((d) => d.value);
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

    const { lead, customer: resolvedCustomer } = resolved;

    const sessionCookies = sapService.getSessionCookies(req);
    if (!sessionCookies) {
      return res.status(401).json({
        preview: true,
        error: 'SAP session expired or invalid',
        message: 'Please log in to SAP first, then try Convert to SAP again.',
      });
    }

    const supabase = getSupabaseAdmin();
    let customer = resolvedCustomer;

    if (!customer && lead.customer_id) {
      const { data } = await supabase
        .from('customer')
        .select(
          'id, customer_code, customer_name, email, phone_number, synced_to_sap_at, sap_card_code, sap_sync_environment'
        )
        .eq('id', lead.customer_id)
        .is('deleted_at', null)
        .maybeSingle();
      customer = data;
    }

    const customerName = getEffectiveLeadName(lead);
    let portalCode = customer?.customer_code || null;
    let portalCodeNote = null;

    if (!portalCode) {
      try {
        portalCode = await customerService.getNextPortalCardCode(supabase);
        portalCodeNote = 'New portal code (assigned on confirm)';
      } catch {
        portalCode = 'CP?????';
        portalCodeNote = 'Could not reserve next portal code';
      }
    }

    const virtualCustomer = customer
      ? { ...customer, customer_name: customerName }
      : {
          customer_code: portalCode,
          customer_name: customerName,
          email: lead.email || null,
          phone_number: lead.handphone || null,
        };

    const sapPayload = transformToSAPBusinessPartner(virtualCustomer, lead);
    const validation = validateBusinessPartnerData(sapPayload);

    let sapAction = 'create';
    let sapLeadCode = null;
    let linkMatch = null;
    let contactMismatch = false;
    let linkConfidence = null;
    let sapContact = null;
    let warnings = [];
    let alreadySynced = false;
    let needsResync = false;
    let verificationReason = null;

    const effectiveCode = customer ? getEffectiveSapCardCode(customer) : null;

    if (customer?.synced_to_sap_at && effectiveCode) {
      const verification = await verifyCustomerSapStatus(customer, sessionCookies, { supabase });
      if (verification.inSap && !verification.needsResync) {
        alreadySynced = true;
        sapAction = 'already_synced';
        sapLeadCode = effectiveCode;
      } else {
        needsResync = true;
        sapAction = 'resync';
        sapLeadCode = effectiveCode;
        verificationReason = verification.reason;
      }
    } else if (effectiveCode && /^L/i.test(effectiveCode)) {
      const exists = await sapService.businessPartnerExists(effectiveCode, sessionCookies);
      if (exists) {
        sapAction = 'existing';
        sapLeadCode = effectiveCode;
      }
    }

    let sapEmail = sapPayload.EmailAddress || null;
    let sapPhone = sapPayload.Phone1 || null;
    let sapCardName = sapPayload.CardName;

    if (!alreadySynced && sapAction === 'create') {
      const linkResult = await tryLinkExistingSapLeadPartner(virtualCustomer, sessionCookies);
      if (linkResult?.sapCardCode) {
        sapAction = 'link';
        sapLeadCode = linkResult.sapCardCode;
        linkMatch = linkResult.match;
        contactMismatch = Boolean(linkResult.contactMismatch);
        linkConfidence = linkResult.linkConfidence || null;
        sapContact = linkResult.sapContact || null;

        const bp = linkResult.businessPartner;
        if (bp) {
          sapEmail = String(bp.EmailAddress || '').trim() || sapEmail;
          sapPhone = String(bp.Phone1 || bp.Cellular || '').trim() || sapPhone;
          sapCardName = bp.CardName || sapCardName;
        } else if (sapContact) {
          sapEmail = sapContact.email || sapEmail;
          sapPhone = sapContact.phone || sapPhone;
        }

        if (contactMismatch) {
          warnings.push(
            `Name matches ${linkResult.sapCardCode} but email/phone differ — confirm this is the same person`
          );
        } else if (linkConfidence === 'low') {
          warnings.push(
            `Low-confidence match for ${linkResult.sapCardCode} — review contact details before confirming`
          );
        }
      } else {
        sapLeadCode = '(assigned by SAP on confirm)';
      }
    }

    const siblingPortalCustomers = await findSiblingPortalCustomers(supabase, {
      email: lead.email,
      phone: lead.handphone,
      excludeCustomerId: customer?.id,
      excludeCustomerCode: portalCode,
    });
    if (siblingPortalCustomers.length > 0) {
      const codes = siblingPortalCustomers.map((s) => s.customer_code).join(', ');
      warnings.push(
        `Another portal record (${codes}) exists for this email/phone — review or merge before converting`
      );
    }

    return res.status(200).json({
      preview: true,
      leadId,
      lead: {
        fullName: customerName,
        email: lead.email || null,
        phone: lead.handphone || null,
        address: getCustomerAddressFromLead(lead) || lead.address || null,
        timeSlot: lead.time_slot || null,
      },
      portal: {
        code: portalCode,
        note: portalCodeNote,
        isNew: !customer,
      },
      sap: {
        action: sapAction,
        leadCode: sapLeadCode,
        cardType: 'L',
        series: sapPayload.Series,
        cardName: sapCardName,
        email: sapEmail,
        phone: sapPhone,
        environment: getCurrentSapSyncEnvironment(),
        linkMatch,
        contactMismatch,
        linkConfidence,
        sapContact,
        alreadySynced,
        needsResync,
        verificationReason,
      },
      warnings,
      siblingPortalCustomers,
      serviceDates: collectServiceDates(lead),
      jobsNote: 'No jobs will be created on convert. Use Create Jobs from Lead after sync.',
      validation: {
        isValid: validation.isValid,
        errors: validation.errors || [],
      },
      canProceed: validation.isValid && !alreadySynced,
    });
  } catch (error) {
    console.error('convert-preview error:', error);
    return res.status(500).json({
      preview: true,
      error: 'Internal server error',
      message: error.message,
    });
  }
}

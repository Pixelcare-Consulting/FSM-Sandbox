import { leadService } from '../supabase/database';
import { getSupabaseAdmin } from '../supabase/server';
import {
  isValidUuid,
  parsePortalSyntheticCustomerId,
  syntheticLeadFromCustomer,
} from './portalSyntheticLead.js';

export { isValidUuid, parsePortalSyntheticCustomerId, syntheticLeadFromCustomer };

const CUSTOMER_SELECT = `
  id,
  customer_code,
  customer_name,
  email,
  phone_number,
  customer_address,
  block,
  unit,
  notes,
  synced_to_sap_at,
  sap_card_code,
  sap_sync_environment,
  source,
  created_at
`;

const LEAD_SELECT = `
  *,
  customer:customer_id(
    id,
    customer_code,
    customer_name,
    phone_number,
    block,
    unit,
    synced_to_sap_at,
    sap_card_code
  )
`;

/**
 * Resolve a lead UUID or portal synthetic id `cust-{customerUuid}`.
 * @returns {Promise<{ customer, lead, isPortalSynthetic, hasLinkedLead }|null>}
 */
export async function resolveLeadOrPortalCustomer(leadId, supabase = null) {
  const id = String(leadId || '').trim();
  if (!id) return null;

  const db = supabase || getSupabaseAdmin();
  const portalCustomerId = parsePortalSyntheticCustomerId(id);

  if (portalCustomerId) {
    const { data: customer, error: custErr } = await db
      .from('customer')
      .select(CUSTOMER_SELECT)
      .eq('id', portalCustomerId)
      .is('deleted_at', null)
      .maybeSingle();

    if (custErr && custErr.code !== 'PGRST116') throw custErr;
    if (!customer) return null;

    const { data: leadRow, error: leadErr } = await db
      .from('leads')
      .select(LEAD_SELECT)
      .eq('customer_id', portalCustomerId)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (leadErr && leadErr.code !== 'PGRST116') throw leadErr;

    return {
      customer,
      lead: leadRow || syntheticLeadFromCustomer(customer),
      isPortalSynthetic: true,
      hasLinkedLead: Boolean(leadRow),
    };
  }

  if (!isValidUuid(id)) return null;

  const lead = await leadService.findById(id, db);
  if (!lead) return null;

  let customer = lead.customer || null;
  if (!customer && lead.customer_id) {
    const { data } = await db
      .from('customer')
      .select(CUSTOMER_SELECT)
      .eq('id', lead.customer_id)
      .is('deleted_at', null)
      .maybeSingle();
    customer = data;
  }

  return {
    customer,
    lead,
    isPortalSynthetic: false,
    hasLinkedLead: true,
  };
}

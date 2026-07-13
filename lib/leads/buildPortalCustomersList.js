import { getEffectiveLeadName } from './getEffectiveLeadName';

export function deriveLeadPortalSource(lead) {
  if (lead?.source === 'GOOGLE_FORM' || lead?.google_form_response_id) {
    return 'google_form';
  }
  return 'manual_lead';
}

export function transformLeadToResponse(lead) {
  const firstName = lead.first_name || '';
  const lastName = lead.last_name || '';
  const effectiveName = getEffectiveLeadName(lead);
  const fullName = effectiveName === 'Unknown Customer' ? '-' : effectiveName;

  const addressParts = [
    lead.building,
    lead.street,
    lead.postcode,
    lead.country,
  ].filter((part) => part && part.trim() !== '');
  const address =
    addressParts.length > 0 ? addressParts.join(', ') : lead.address || '-';

  return {
    id: lead.id,
    timestamp: lead.submitted_at || lead.created_at,
    email: lead.email,
    block:
      lead.block && String(lead.block).trim() !== '' && lead.block !== '-'
        ? lead.block
        : lead.customer?.block != null && lead.customer.block !== ''
          ? lead.customer.block
          : '-',
    unit:
      lead.unit && String(lead.unit).trim() !== '' && lead.unit !== '-'
        ? lead.unit
        : lead.customer?.unit != null && lead.customer.unit !== ''
          ? lead.customer.unit
          : '-',
    address,
    salutation: lead.salutation || '-',
    firstName: firstName || '-',
    lastName: lastName || '-',
    fullName,
    building: lead.building || '-',
    street: lead.street || '-',
    postcode: lead.postcode || '-',
    country: lead.country || '-',
    handphone:
      (lead.handphone && String(lead.handphone).trim() !== '' && lead.handphone !== '-'
        ? lead.handphone
        : lead.customer?.phone_number) || '-',
    firstServiceDate: lead.first_service_date || '-',
    secondServiceDate: lead.second_service_date || '-',
    thirdServiceDate: lead.third_service_date || '-',
    fourthServiceDate: lead.fourth_service_date || '-',
    timeSlot: lead.time_slot || '-',
    agreedToTerms: lead.agreed_to_terms ? 'Yes' : 'No',
    personalInfoConsent: lead.personal_info_consent ? 'Yes' : 'No',
    status: lead.status || 'PENDING',
    source: lead.source || 'GOOGLE_FORM',
    portalSource: deriveLeadPortalSource(lead),
    rowType: 'lead',
    notes: lead.notes,
    customer_id: lead.customer_id || null,
    customer_code: lead.customer?.customer_code || null,
    sap_card_code: lead.customer?.sap_card_code || null,
    synced_to_sap_at: lead.customer?.synced_to_sap_at || null,
    _leadData: lead,
  };
}

export function mergePortalCustomersList(leads = [], genericCustomers = []) {
  const transformedLeads = leads.map(transformLeadToResponse);
  const leadCustomerIds = new Set(transformedLeads.map((l) => l.customer_id).filter(Boolean));
  const standaloneCustomers = genericCustomers.filter((c) => !leadCustomerIds.has(c.id));

  const customerRows = standaloneCustomers.map((c) => ({
    id: `cust-${c.id}`,
    rowType: 'customer',
    customer_id: c.id,
    customer_code: c.customer_code,
    sap_card_code: c.sap_card_code || null,
    lead_id: c.lead_id || null,
    fullName: c.customer_name,
    email: c.email,
    handphone: c.phone_number || '-',
    address: c.customer_address || '-',
    block: c.block != null && c.block !== '' ? c.block : '-',
    unit: c.unit != null && c.unit !== '' ? c.unit : '-',
    notes: c.notes ?? '',
    timestamp: c.created_at || null,
    created_at: c.created_at || null,
    portalSource: 'internal',
    status: c.synced_to_sap_at ? 'CONVERTED' : 'PENDING',
    firstServiceDate: '-',
    salutation: '-',
    firstName: '-',
    lastName: '-',
    synced_to_sap_at: c.synced_to_sap_at || null,
  }));

  const merged = [...transformedLeads, ...customerRows];
  merged.sort((a, b) => {
    const matchA = (a.customer_code || '').match(/^CP(\d+)$/i);
    const matchB = (b.customer_code || '').match(/^CP(\d+)$/i);
    const numA = matchA ? parseInt(matchA[1], 10) : 999999;
    const numB = matchB ? parseInt(matchB[1], 10) : 999999;
    return numA - numB;
  });
  return merged;
}

export async function fetchPortalCustomersList() {
  const [leadsRes, genericRes] = await Promise.all([
    fetch('/api/leads', { credentials: 'include', cache: 'no-store' }),
    fetch('/api/customers/generic', { credentials: 'include', cache: 'no-store' }),
  ]);
  if (!leadsRes.ok) {
    const body = await leadsRes.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch leads (${leadsRes.status})`);
  }
  const leadsData = await leadsRes.json();
  let genericCustomers = [];
  if (genericRes.ok) {
    const genericData = await genericRes.json();
    genericCustomers = genericData.customers || [];
  }
  const rows = mergePortalCustomersList(leadsData.leads || [], genericCustomers);
  return { rows };
}

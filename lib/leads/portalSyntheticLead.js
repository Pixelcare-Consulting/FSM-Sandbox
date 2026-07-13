const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return UUID_REGEX.test(String(value || '').trim());
}

/**
 * Extract customer UUID from portal synthetic id `cust-{uuid}`.
 * @returns {string|null} customer UUID or null if invalid
 */
export function parsePortalSyntheticCustomerId(leadId) {
  const id = String(leadId || '').trim();
  if (!id.startsWith('cust-')) return null;
  const customerId = id.replace(/^cust-/, '');
  if (!customerId || !isValidUuid(customerId)) return null;
  return customerId;
}

/**
 * Build a lead-shaped object from a portal customer (no linked leads row).
 */
export function syntheticLeadFromCustomer(customer) {
  if (!customer) return null;
  return {
    id: `cust-${customer.id}`,
    full_name: customer.customer_name || null,
    email: customer.email || null,
    handphone: customer.phone_number || null,
    block: customer.block ?? null,
    unit: customer.unit ?? null,
    customer_id: customer.id,
    building: null,
    street: null,
    postcode: null,
    country: null,
    address: customer.customer_address || null,
    notes: customer.notes ?? null,
    first_service_date: null,
    second_service_date: null,
    third_service_date: null,
    fourth_service_date: null,
    time_slot: null,
    status: customer.synced_to_sap_at ? 'CONVERTED' : 'PENDING',
    customer: {
      id: customer.id,
      customer_code: customer.customer_code,
      customer_name: customer.customer_name,
      phone_number: customer.phone_number,
      block: customer.block,
      unit: customer.unit,
      synced_to_sap_at: customer.synced_to_sap_at,
      sap_card_code: customer.sap_card_code,
    },
  };
}

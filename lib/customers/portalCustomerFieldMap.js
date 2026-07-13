/**
 * Shared mapping from Create Customer / Google Form payloads to portal Supabase shapes.
 */

function sanitizeDash(value) {
  if (value == null || value === '' || value === '-') return null;
  return String(value).trim() || null;
}

function buildAddressString(addr) {
  if (!addr) return null;
  const parts = [
    addr.AddressName,
    addr.Street,
    addr.BuildingFloorRoom,
    addr.City,
    addr.ZipCode,
    addr.Country,
  ]
    .map(sanitizeDash)
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Map validated create-customer SAP payload to customer table columns.
 */
export function mapCreatePayloadToCustomerFields(payload, customerCode) {
  const billTo =
    (payload.BPAddresses || []).find((a) => a.AddressType === 'bo_BillTo') ||
    payload.BPAddresses?.[0];

  return {
    customer_code: customerCode,
    customer_name: String(payload.CardName || '').trim(),
    customer_address: buildAddressString(billTo),
    phone_number: sanitizeDash(payload.Phone1) || sanitizeDash(payload.Phone2),
    email: sanitizeDash(payload.EmailAddress),
    block: sanitizeDash(payload.Block) || sanitizeDash(billTo?.Block),
    unit: sanitizeDash(payload.Unit),
    notes: sanitizeDash(payload.FreeText) || sanitizeDash(payload.Remarks),
    source: 'portal',
  };
}

/**
 * Map create payload to a lead-like shape for ensurePortalCustomerAddressFromLead.
 */
export function mapCreatePayloadToLeadShape(payload) {
  const billTo =
    (payload.BPAddresses || []).find((a) => a.AddressType === 'bo_BillTo') ||
    payload.BPAddresses?.[0];
  const shipTo = (payload.BPAddresses || []).find((a) => a.AddressType === 'bo_ShipTo');

  const primaryAddr = billTo || shipTo;
  const billAddressName = sanitizeDash(billTo?.AddressName);
  const shipAddressName = sanitizeDash(shipTo?.AddressName) || billAddressName;

  return {
    full_name: String(payload.CardName || '').trim(),
    email: sanitizeDash(payload.EmailAddress),
    handphone: sanitizeDash(payload.Phone1) || sanitizeDash(payload.Phone2),
    block: sanitizeDash(payload.Block) || sanitizeDash(primaryAddr?.Block),
    unit: sanitizeDash(payload.Unit),
    building: sanitizeDash(primaryAddr?.BuildingFloorRoom),
    street: sanitizeDash(primaryAddr?.Street),
    postcode: sanitizeDash(primaryAddr?.ZipCode),
    country: sanitizeDash(primaryAddr?.Country) || 'SG',
    address: buildAddressString(primaryAddr),
    notes: sanitizeDash(payload.FreeText) || sanitizeDash(payload.Remarks),
    // Stable SAP AddressName keys — shared by bill+ship when same physical site
    address_name: billAddressName || shipAddressName,
    bill_address_name: billAddressName,
    ship_address_name: shipAddressName,
  };
}

/**
 * Normalize ContactEmployees from create payload to contacts table rows.
 */
export function mapCreatePayloadToContacts(payload) {
  const employees = payload.ContactEmployees;
  if (!Array.isArray(employees) || employees.length === 0) return [];

  return employees
    .map((ce) => {
      const firstName = sanitizeDash(ce.FirstName) || sanitizeDash(ce.Name) || '';
      const lastName = sanitizeDash(ce.LastName) || '';
      const phone = sanitizeDash(ce.Phone1) || sanitizeDash(ce.MobilePhone);
      const email = sanitizeDash(ce.E_Mail);
      if (!firstName && !lastName && !phone && !email) return null;
      return {
        first_name: firstName,
        middle_name: sanitizeDash(ce.MiddleName),
        last_name: lastName,
        tel1: phone,
        tel2: sanitizeDash(ce.Phone2),
        email,
      };
    })
    .filter(Boolean);
}

/**
 * Extra site addresses beyond the required Bill To and Ship To rows.
 */
export function mapCreatePayloadToExtraLocations(payload) {
  const addresses = payload.BPAddresses || [];
  const extras = addresses.slice(2);
  return extras.map((addr) => ({
    siteId: sanitizeDash(addr.AddressName) || 'Additional',
    building: sanitizeDash(addr.BuildingFloorRoom),
    street: sanitizeDash(addr.Street),
    block: sanitizeDash(addr.Block),
    postcode: sanitizeDash(addr.ZipCode),
    country: sanitizeDash(addr.Country) || 'SG',
    addressType: addr.AddressType || 'bo_ShipTo',
    address: buildAddressString(addr),
  }));
}

/**
 * @param {string} customerCode
 * @returns {Promise<{ data: Record<string, unknown>, dataByCustomerLocationId: Record<string, unknown> }>}
 */
export async function fetchCustomerAddressDetails(customerCode) {
  if (!customerCode) {
    return { data: {}, dataByCustomerLocationId: {} };
  }

  const response = await fetch(
    `/api/customers/address-details/${encodeURIComponent(customerCode)}`,
    {
      credentials: 'same-origin',
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load address details (${response.status})`);
  }

  const json = await response.json();
  if (!json?.success) {
    return { data: {}, dataByCustomerLocationId: {} };
  }

  return {
    data: json.data || {},
    dataByCustomerLocationId: json.dataByCustomerLocationId || {},
  };
}

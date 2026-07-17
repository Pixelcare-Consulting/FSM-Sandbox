import { textMatchesAllSearchTokens } from '../utils/multiTokenSearch';

/**
 * Build the same lowercased search haystack as the Customers list page
 * (`pages/dashboard/customers/list.js` global search filter).
 */
export function buildCustomerListSearchBlob(customer) {
  if (!customer) return '';

  const searchableFields = [
    customer.CardCode,
    customer.CardName,
    customer.CardForeignName,
    customer.Phone1,
    customer.Phone2,
    customer.Cellular,
    customer.Fax,
    customer.EmailAddress,
    customer.Address,
    customer.MailAddress,
    customer.Street,
    customer.ZipCode,
    customer.Building,
    customer.BillToBuildingFloorRoom,
    customer.BilltoDefault,
    customer.ShipToDefault,
    customer.City,
    customer.Block,
    customer.County,
    customer.Country,
    customer.Address1,
    customer.Address2,
    customer.Address3,
    customer.PostalCode,
    customer.FederalTaxID,
    customer.GroupCode,
    customer.Currency,
    customer.ContactPerson,
    customer.U_Contract,
    customer.U_ContractStartDate,
    customer.U_ContractEndDate,
    customer.Notes,
    customer.FreeText
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let bpAddressText = '';
  if (customer.BPAddresses && customer.BPAddresses.length > 0) {
    bpAddressText = customer.BPAddresses.map((addr) =>
      [
        addr.AddressName,
        addr.Street,
        addr.BuildingFloorRoom,
        addr.Building,
        addr.ZipCode,
        addr.City,
        addr.Block,
        addr.County,
        addr.Country,
        addr.AddressType
      ]
        .filter(Boolean)
        .join(' ')
    )
      .join(' ')
      .toLowerCase();
  }

  let allAddressesText = '';
  if (customer.AllAddresses && customer.AllAddresses.length > 0) {
    allAddressesText = customer.AllAddresses.map((addr) =>
      [
        addr.AddressName,
        addr.SiteID,
        addr.Address1,
        addr.Address2,
        addr.Address3,
        addr.Street,
        addr.Building,
        addr.PostalCode,
        addr.ZipCode,
        addr.Country,
      ]
        .filter(Boolean)
        .join(' ')
    )
      .join(' ')
      .toLowerCase();
  }

  return `${searchableFields} ${bpAddressText} ${allAddressesText}`.trim();
}

/**
 * @param {string} searchQueryLower - already `.toLowerCase().trim()` (or will be normalized)
 */
export function customerMatchesListGlobalSearch(customer, searchQueryLower) {
  const q = String(searchQueryLower || '')
    .trim()
    .toLowerCase();
  if (!q) return true;
  const combinedText = buildCustomerListSearchBlob(customer);
  return textMatchesAllSearchTokens(combinedText, q);
}

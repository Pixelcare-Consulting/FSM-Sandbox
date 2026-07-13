export function applySapCustomerMasterlistFilters(query) {
  return query.not('customer_code', 'ilike', 'CP%');
}

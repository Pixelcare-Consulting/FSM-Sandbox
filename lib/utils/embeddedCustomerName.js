/**
 * AIFM import stores `[CUSTOMER:name]` in `jobs.description` when no local/SAP customer match.
 * Use these helpers anywhere a job's customer is shown so UI stays consistent with list-jobs.
 */

import { decodePortalHtmlEntities } from './formatPortalBpAddress.js';

function decodeDisplayName(value) {
  const decoded = decodePortalHtmlEntities(value).trim();
  return decoded || '';
}

export function parseEmbeddedCustomerName(description) {
  if (!description) return null;
  const m = String(description).match(/\[CUSTOMER:([^\]]+)\]/);
  return m ? decodeDisplayName(m[1]) || null : null;
}

/** True when tag value was polluted with card code prefix (e.g. "L004466 HOR GUOYONG"). */
export function embeddedTagHasCustomerCodePrefix(embedded, customerCode) {
  if (!embedded || !customerCode) return false;
  const code = String(customerCode).trim();
  if (!code) return false;
  const value = String(embedded).trim();
  if (value === code) return true;
  return value.startsWith(`${code} `);
}

/** Strip leading L####/C#### card code from embedded tag content. */
export function stripCardCodePrefixFromEmbeddedName(embedded) {
  if (!embedded) return '';
  const value = String(embedded).trim();
  const m = value.match(/^[LC]\d+\s+(.+)$/);
  return m ? m[1].trim() : value;
}

/**
 * Display name for scheduler / job lists.
 * Prefer `[CUSTOMER:…]` from AIFM import (site contact / full name) over linked SAP
 * account name (often short, e.g. "TAN" vs "TAN SOCK TING").
 * When tag was polluted with card code + name, prefer linked customer.customer_name.
 */
export function jobDisplayCustomerName(job) {
  if (!job) return '';
  const embedded = parseEmbeddedCustomerName(job.description);
  const linked = decodeDisplayName(job.customer?.customer_name || '');
  const customerCode = (job.customer?.customer_code || '').toString().trim();

  if (embedded) {
    if (
      job.customer_id &&
      linked &&
      customerCode &&
      embeddedTagHasCustomerCodePrefix(embedded, customerCode)
    ) {
      return linked;
    }
    return embedded;
  }
  return linked || '';
}

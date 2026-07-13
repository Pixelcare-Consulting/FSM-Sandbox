/**
 * Align Excel-derived site keys from the AIFM masterlist with public.customer_location.site_id.
 *
 * Handles:
 *   - Exact match vs lib/supabase/migrations/backfill_strip_site_id_numeric_suffix.sql (stripped postal)
 *   - Comma-normalized site_id (SQL + importer: ` · S · ` / ` · B · ` → commas; trailing ` · S` / ` · B` stripped)
 *   - SAP inconsistencies: Billing sometimes stored as bare AIFM nickname; Ship-to sometimes "nick · S"
 */

const { str, sapAdresType } = require('./aifmMasterlistRowFields');

/** Normalize B/S / bo_BillTo / bo_ShipTo for cache keys and duplicate-row disambiguation. */
function normalizeAddressTypeCacheKey(addressType) {
  const t = str(addressType).toUpperCase();
  if (t === 'B' || t === 'BO_BILLTO' || t === 'BILLTO') return 'B';
  if (t === 'S' || t === 'BO_SHIPTO' || t === 'SHIPTO') return 'S';
  return t || 'U';
}

/** Importer in-memory cache key: one row per customer + site + address type. */
function customerLocationCacheKey(customerId, siteId, addressType) {
  return `${customerId}|${str(siteId)}|${normalizeAddressTypeCacheKey(addressType)}`;
}

/**
 * `customer_address_details.address_name` is UNIQUE per customer_code.
 * Bill-to keeps bare site_id; ship-to at the same unit uses `site_id|S` (UI resolves via FK + lookup keys).
 */
function addressDetailsStorageName(siteId, addressType) {
  const base = str(siteId);
  if (!base) return '';
  const typeKey = normalizeAddressTypeCacheKey(addressType);
  if (typeKey === 'S') return `${base}|S`;
  return base;
}

/** Strip trailing postal tails: middot (` · 403032`) and comma (` , 403032`). */
function stripTrailingPostalFromSiteKey(siteId) {
  return str(siteId)
    .replace(/ · \d+$/, '')
    .replace(/, \d+$/, '');
}

/**
 * Storage / UI-normalized AddressName-style key:
 * - `#02-03 SAGE @ NASSIM · S · 258379` → `#02-03 SAGE @ NASSIM, 258379`
 * - Tail-only ship/bill: `… · zip · S` → `… · zip` (type still on the row elsewhere)
 */
function commaSapSeparatorStyle(siteId) {
  let s = str(siteId);
  if (!s) return s;
  s = s.replace(/ · S · /gi, ', ').replace(/ · B · /gi, ', ');
  s = s.replace(/ · S$/i, '').replace(/ · B$/i, '');
  return s;
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  for (const x of list) {
    const t = str(x);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Candidate keys matching `customer_location.site_id`: exact Excel key, postal-stripped sibling,
 * and comma-style variant (matches DB rows after normalization that replaces ` · S · ` / ` · B · `).
 */
function siteKeyVariants(siteId) {
  const s = str(siteId);
  if (!s) return [];
  const stripped = stripTrailingPostalFromSiteKey(s);
  const commaS = commaSapSeparatorStyle(s);
  const commaStripped = stripTrailingPostalFromSiteKey(commaS);
  return uniqStrings([s, stripped, commaS, commaStripped]);
}

function zipFromMasterlistRow(row) {
  return str(row?.SAP_ZipCode) || str(row?.SAP_Zip) || str(row?.AIFM_LOC_Zip) || null;
}

/** @returns {Promise<{ id: string, site_id: string } | null>} */
async function lookupCustomerLocationRow(supabase, customerId, excelSiteId, zipHint, row) {
  const keys = siteKeyVariants(excelSiteId);
  const zh = str(zipHint);

  for (const key of keys) {
    const { data, error } = await supabase
      .from('customer_location')
      .select('id, zip_code, site_id, address_type')
      .eq('customer_id', customerId)
      .eq('site_id', key)
      .limit(10);

    if (error && error.code !== 'PGRST116') {
      throw new Error(`customer_location lookup: ${error.message}`);
    }
    const rows = data || [];
    if (rows.length === 1) return { id: rows[0].id, site_id: str(rows[0].site_id) };
    if (rows.length > 1) {
      const wantType = row ? normalizeAddressTypeCacheKey(sapAdresType(row)) : '';
      if (wantType) {
        const byType = rows.find(
          (r) => normalizeAddressTypeCacheKey(r.address_type) === wantType
        );
        if (byType) return { id: byType.id, site_id: str(byType.site_id) };
      }
      if (zh) {
        const hit = rows.find((r) => str(r.zip_code) === zh);
        if (hit) return { id: hit.id, site_id: str(hit.site_id) };
      }
    }
  }

  const nick = row ? str(row.AIFM_LOC_NickName) : '';
  const at = row ? sapAdresType(row) : '';
  if (!nick || !zh || !(at === 'B' || at === 'S')) return null;

  const { data: zRows, error: zErr } = await supabase
    .from('customer_location')
    .select('id, zip_code, site_id')
    .eq('customer_id', customerId)
    .eq('zip_code', zh)
    .limit(80);

  if (zErr && zErr.code !== 'PGRST116') {
    throw new Error(`customer_location lookup: ${zErr.message}`);
  }
  const pool = zRows || [];
  const typeKey = `${nick} · ${at}`;
  const commaFullGuess = commaSapSeparatorStyle(`${nick} · ${at} · ${zh}`);
  const typeMatches = pool.filter((r) => {
    const sid = str(r.site_id);
    const sidComma = commaSapSeparatorStyle(sid);
    if (sidComma === commaFullGuess) return true;
    return sid === typeKey || sid.startsWith(`${typeKey} ·`);
  });
  if (typeMatches.length === 1) {
    const r = typeMatches[0];
    return { id: r.id, site_id: str(r.site_id) };
  }

  const bareNick = pool.filter((r) => str(r.site_id) === nick);
  if (bareNick.length === 1) {
    const r = bareNick[0];
    return { id: r.id, site_id: str(r.site_id) };
  }

  return null;
}

module.exports = {
  stripTrailingPostalFromSiteKey,
  commaSapSeparatorStyle,
  siteKeyVariants,
  zipFromMasterlistRow,
  lookupCustomerLocationRow,
  normalizeAddressTypeCacheKey,
  customerLocationCacheKey,
  addressDetailsStorageName,
};

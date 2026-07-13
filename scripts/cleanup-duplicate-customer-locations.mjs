#!/usr/bin/env node
/**
 * Cleanup duplicate `customer_location` Bill To / Ship To rows for a customer.
 *
 * Groups by:
 *   1) normalized site_id (strips trailing " - 1") + address_type
 *   2) similar address content + address_type (portal deriveSiteId vs SAP AddressName)
 *
 * Primary safety rule: never delete a customer_location row when any active job references its `location_id`.
 * Default mode is dry-run. Apply mode requires `--apply --yes`.
 * Do NOT run destructive SQL against production without dry-run review first.
 *
 * Examples (C006158 stacked Bill/Ship cleanup):
 *   node scripts/cleanup-duplicate-customer-locations.mjs --customer-code=C006158 --dry-run
 *   node scripts/cleanup-duplicate-customer-locations.mjs --customer-code=C006158 --apply --yes
 *   node scripts/cleanup-duplicate-customer-locations.mjs --customer-code=C000446 --site-id=MAIN --dry-run
 *
 * Inspect-only SQL (safe):
 *   SELECT id, site_id, address_type, street, building, address, location_id, created_at
 *   FROM customer_location
 *   WHERE customer_id = (SELECT id FROM customer WHERE customer_code = 'C006158' AND deleted_at IS NULL)
 *   ORDER BY address_type, site_id, created_at;
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { createClient } = require('@supabase/supabase-js');

function parseArgs(argv) {
  const out = {
    dryRun: true,
    apply: false,
    yes: false,
    customerCode: '',
    siteId: '',
    verbose: false,
    limitGroups: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--apply') out.apply = true;
    if (a === '--yes') out.yes = true;
    if (a === '--verbose') out.verbose = true;
    if (a.startsWith('--customer-code=')) out.customerCode = a.slice(16).trim();
    if (a.startsWith('--site-id=')) out.siteId = a.slice(10).trim();
    if (a.startsWith('--limit-groups=')) out.limitGroups = Math.max(0, parseInt(a.slice(15), 10) || 0);
  }
  if (out.apply) out.dryRun = false;
  return out;
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function normalizeAddressType(value) {
  const t = str(value).toUpperCase();
  if (!t) return '';
  if (t === 'B' || t === 'BO_BILLTO' || t === 'BILLTO') return 'bo_BillTo';
  if (t === 'S' || t === 'BO_SHIPTO' || t === 'SHIPTO') return 'bo_ShipTo';
  return str(value);
}

function normText(value) {
  return str(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function similarAddressKey(row) {
  // "Similar" grouping catches cases where site_id differs (suffixes, zip tails, etc),
  // but the actual address content is effectively the same.
  const type = normalizeAddressType(row.address_type);
  const street = normText(row.street);
  const building = normText(row.building);
  const address = normText(row.address);
  const zip = normText(row.zip_code);
  const country = normText(row.country_name);
  const city = normText(row.city);
  const core = [street, building, address].filter(Boolean).join('|');
  return `${type}||${core}||${zip}||${city}||${country}`;
}

async function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchCustomerByCode(supabase, customerCode) {
  const { data, error } = await supabase
    .from('customer')
    .select('id, customer_code')
    .eq('customer_code', customerCode)
    .is('deleted_at', null)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw new Error(`customer lookup: ${error.message}`);
  return data || null;
}

async function fetchCustomerLocations(supabase, customerId, siteIdFilter) {
  // Some environments have deleted_at on customer_location, some don't. Prefer filtering when present.
  const baseSelect =
    'id, customer_id, site_id, address_type, location_id, building, street, block, address, city, country_name, zip_code, created_at, updated_at, deleted_at';
  const legacySelect =
    'id, customer_id, site_id, address_type, location_id, building, street, block, address, city, country_name, zip_code';

  function buildQuery(selectList) {
    let q = supabase.from('customer_location').select(selectList).eq('customer_id', customerId);
    if (siteIdFilter) q = q.eq('site_id', siteIdFilter);
    return q;
  }

  async function execWithOptionalDeletedAt(selectList) {
    // Important: Supabase query builders are mutable; don't reuse between attempts.
    const withDel = buildQuery(selectList).is('deleted_at', null);
    let { data, error } = await withDel;
    if (error && /deleted_at/i.test(error.message || '')) {
      ({ data, error } = await buildQuery(selectList));
    }
    if (error && /column .*deleted_at/i.test(error.message || '')) {
      ({ data, error } = await buildQuery(selectList));
    }
    return { data, error };
  }

  let { data, error } = await execWithOptionalDeletedAt(baseSelect);
  if (error && /column .*customer_location\./i.test(error.message || '')) {
    // Column list mismatch (schema drift). Retry with a minimal column set.
    ({ data, error } = await execWithOptionalDeletedAt(legacySelect));
  }
  if (error && error.code !== 'PGRST116') throw new Error(`customer_location fetch: ${error.message}`);
  return data || [];
}

async function countActiveJobsForLocationId(supabase, locationId) {
  if (!locationId) return 0;
  const { count, error } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .is('deleted_at', null);
  if (error) throw new Error(`jobs count(location_id=${locationId}): ${error.message}`);
  return count || 0;
}

async function countContactsForCustomerLocationId(supabase, customerLocationId) {
  if (!customerLocationId) return 0;
  const { count, error } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('customer_location_id', customerLocationId);
  if (error) {
    // Legacy DBs may not have contacts.customer_location_id; ignore signal in that case.
    if (/customer_location_id/i.test(error.message || '')) return 0;
    throw new Error(`contacts count(customer_location_id=${customerLocationId}): ${error.message}`);
  }
  return count || 0;
}

async function countAddressDetailsForCustomerLocationId(supabase, customerLocationId) {
  if (!customerLocationId) return 0;
  let { count, error } = await supabase
    .from('customer_address_details')
    .select('id', { count: 'exact', head: true })
    .eq('customer_location_id', customerLocationId)
    .is('deleted_at', null);
  if (error) {
    if (/customer_address_details|customer_location_id/i.test(error.message || '')) return 0;
    throw new Error(`customer_address_details count(customer_location_id=${customerLocationId}): ${error.message}`);
  }
  return count || 0;
}

function normalizeSiteIdForGrouping(siteId) {
  const s = str(siteId);
  const suffix = ' - 1';
  if (s.endsWith(suffix)) return s.slice(0, -suffix.length);
  return s;
}

function groupKey(row) {
  const site = normalizeSiteIdForGrouping(row.site_id).toLowerCase();
  const type = normalizeAddressType(row.address_type);
  return `${site}||${type}`;
}

function pickCanonical(rowsWithSignals) {
  const sorted = [...rowsWithSignals].sort((a, b) => {
    if (b.jobCount !== a.jobCount) return b.jobCount - a.jobCount;
    if (b.contactsCount !== a.contactsCount) return b.contactsCount - a.contactsCount;
    if (b.detailsCount !== a.detailsCount) return b.detailsCount - a.detailsCount;
    // Prefer site_id without invented " - 1" suffix (canonical SAP AddressName).
    const aSuffix = str(a.site_id).endsWith(' - 1') ? 1 : 0;
    const bSuffix = str(b.site_id).endsWith(' - 1') ? 1 : 0;
    if (aSuffix !== bSuffix) return aSuffix - bSuffix;
    const au = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bu = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    if (bu !== au) return bu - au;
    return String(a.id).localeCompare(String(b.id));
  });
  return sorted[0];
}

async function softDeleteAddressDetailsByFk(supabase, customerLocationId, nowIso) {
  let { error } = await supabase
    .from('customer_address_details')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('customer_location_id', customerLocationId)
    .is('deleted_at', null);
  if (error) {
    if (/customer_address_details|customer_location_id/i.test(error.message || '')) return { ok: true, skipped: true };
    throw new Error(`customer_address_details soft delete: ${error.message}`);
  }
  return { ok: true };
}

async function deleteContactsByFk(supabase, customerLocationId) {
  const { error } = await supabase.from('contacts').delete().eq('customer_location_id', customerLocationId);
  if (error) {
    if (/customer_location_id/i.test(error.message || '')) return { ok: true, skipped: true };
    throw new Error(`contacts delete: ${error.message}`);
  }
  return { ok: true };
}

async function deleteCustomerLocationRow(supabase, customerLocationId) {
  // Prefer soft-delete when column exists; fall back to hard delete.
  const nowIso = new Date().toISOString();
  let { error } = await supabase
    .from('customer_location')
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq('id', customerLocationId);
  if (error && /deleted_at/i.test(error.message || '')) {
    ({ error } = await supabase.from('customer_location').delete().eq('id', customerLocationId));
  }
  if (error) throw new Error(`customer_location delete(${customerLocationId}): ${error.message}`);
  return { ok: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.customerCode) {
    console.error('Missing required: --customer-code=C006158');
    process.exit(2);
  }

  if (args.apply && !args.yes) {
    console.error('Refusing to apply changes without --yes. Run with --apply --yes to proceed.');
    process.exit(2);
  }

  const supabase = await getSupabaseAdmin();
  const customer = await fetchCustomerByCode(supabase, args.customerCode);
  if (!customer?.id) {
    console.error(`Customer not found: ${args.customerCode}`);
    process.exit(1);
  }

  const rows = await fetchCustomerLocations(supabase, customer.id, args.siteId);
  if (rows.length === 0) {
    console.log('No customer_location rows found (nothing to do).');
    return;
  }

  const byGroup = new Map();
  for (const r of rows) {
    const key = groupKey(r);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(r);
  }

  const bySimilar = new Map();
  for (const r of rows) {
    const key = similarAddressKey(r);
    const core = key.split('||')[1] || '';
    if (!core) continue;
    if (!bySimilar.has(key)) bySimilar.set(key, []);
    bySimilar.get(key).push(r);
  }

  const siteGroups = [...byGroup.entries()].filter(([, list]) => (list || []).length > 1);
  const similarGroups = [...bySimilar.entries()].filter(([, list]) => (list || []).length > 1);

  if (siteGroups.length === 0 && similarGroups.length === 0) {
    console.log('No duplicate customer_location groups found.');
    return;
  }

  console.log(`Customer: ${args.customerCode} (${customer.id})`);
  console.log(`Site-id duplicate groups: ${siteGroups.length}`);
  console.log(`Similar-content duplicate groups: ${similarGroups.length}`);
  if (args.dryRun) console.log('Mode: DRY RUN (no writes)');
  else console.log('Mode: APPLY');

  const handledIds = new Set();
  let deleted = 0;
  let skippedInUse = 0;
  let skippedProtected = 0;
  let processedGroups = 0;

  async function processGroups(groups, label) {
    const limitedGroups = args.limitGroups ? groups.slice(0, args.limitGroups) : groups;
    for (const [key, list] of limitedGroups) {
      const unresolved = list.filter((r) => !handledIds.has(r.id));
      if (unresolved.length < 2) continue;

      processedGroups++;
      const enriched = [];
      for (const row of unresolved) {
        const jobCount = await countActiveJobsForLocationId(supabase, row.location_id);
        const contactsCount = await countContactsForCustomerLocationId(supabase, row.id);
        const detailsCount = await countAddressDetailsForCustomerLocationId(supabase, row.id);
        enriched.push({ ...row, jobCount, contactsCount, detailsCount });
      }

      const canonical = pickCanonical(enriched);
      const others = enriched.filter((r) => r.id !== canonical.id);
      handledIds.add(canonical.id);

      console.log(
        `\n[${label} ${processedGroups}] key="${key}" duplicates=${unresolved.length} canonical=${canonical.id} site="${str(canonical.site_id)}" type="${normalizeAddressType(canonical.address_type)}"`
      );
      if (args.verbose) {
        for (const r of enriched) {
          console.log(
            `  - ${r.id} site_id="${str(r.site_id)}" location_id=${r.location_id || 'null'} jobs=${r.jobCount} contacts=${r.contactsCount} details=${r.detailsCount}`
          );
        }
      }

      for (const dup of others) {
        if (dup.jobCount > 0) {
          skippedInUse++;
          console.log(`  skip (in use by jobs): ${dup.id} (jobs=${dup.jobCount}, location_id=${dup.location_id})`);
          continue;
        }

        if ((dup.contactsCount > 0 || dup.detailsCount > 0) && canonical.jobCount === 0) {
          const canonicalSignals = (canonical.contactsCount || 0) + (canonical.detailsCount || 0);
          const dupSignals = (dup.contactsCount || 0) + (dup.detailsCount || 0);
          if (dupSignals > canonicalSignals) {
            skippedProtected++;
            console.log(
              `  skip (protected richer row): ${dup.id} (contacts=${dup.contactsCount}, details=${dup.detailsCount})`
            );
            continue;
          }
        }

        if (args.dryRun) {
          console.log(`  would delete: ${dup.id} site_id="${str(dup.site_id)}"`);
          handledIds.add(dup.id);
          continue;
        }

        const nowIso = new Date().toISOString();
        await softDeleteAddressDetailsByFk(supabase, dup.id, nowIso);
        await deleteContactsByFk(supabase, dup.id);
        await deleteCustomerLocationRow(supabase, dup.id);
        deleted++;
        handledIds.add(dup.id);
        console.log(`  deleted: ${dup.id}`);
      }
    }
  }

  await processGroups(siteGroups, 'site');
  await processGroups(similarGroups, 'similar');

  console.log('\nDone.');
  console.log(`  Groups processed: ${processedGroups}`);
  console.log(`  Deleted duplicate rows: ${deleted}`);
  console.log(`  Skipped (in-use by jobs): ${skippedInUse}`);
  console.log(`  Skipped (protected): ${skippedProtected}`);
}

main().catch((e) => {
  console.error(e?.stack || e?.message || e);
  process.exit(1);
});


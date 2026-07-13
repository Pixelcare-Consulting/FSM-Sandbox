/**
 * AIFM → DB Import
 *
 * POST  { jobs: [...enrichedAifmJobs] }
 *   → SSE stream of progress events (step / progress / done / error)
 *   → creates or updates jobs in Supabase using the same sequential job-number
 *     scheme as the Excel jobs migration (YYYY-XXXXXX).
 *
 * When AIFM_API_TOKEN is set and jobs include id_customer without aifm_customer_account_name,
 * the handler merges account names from POST /api/v1/customers (same as preview fetch) so
 * customer resolution uses company/account name, not primary contact on the job row.
 *
 * Full AIFM field mapping:
 *   job_description       → jobs.description (below AIFM marker)
 *   job_priority          → jobs.priority (normal→MEDIUM, high→HIGH, low→LOW, urgent→URGENT)
 *   status                → jobs.status (stored as-is, numeric strings are allowed)
 *   estimated_duration_*  → job_schedule.dur
 *   job_category          → job_category table
 *
 * Customer resolution:
 *   1.  Supabase masterlist CardCode exact match in local DB
 *   1b. Masterlist CardCode supplied but not yet in local DB → auto-create from sap_bp_card_name
 *   2.  Customer name LIKE search (exact → partial)
 *   2b. SAP Leads masterlist (public.sap_lead) by name → local `customer` row with L* CardCode
 *   3.  No customer or lead match → portal CP##### placeholder (see customerService.getNextPortalCardCode)
 *
 * Duplicate detection: prefer [AIFM:<id>] in description; fall back to title
 * "AIFM Job <id>…". If several rows match the same AIFM id, the newest
 * (updated_at, then created_at) is kept; older rows are soft-deleted with
 * schedule/category/assignment cleanup. New job numbers are assigned in scheduled_start
 * order (earliest first), not AIFM id / API page order — see sortAifmJobsForJobNumberAssignment.
 * Next number uses max(YYYY-000000…999999) via one query (avoids duplicate job_number_key errors).
 * On update of an existing job, description is never overwritten (portal edits stick).
 */

import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { requireSession } from '../../../../lib/auth/requireSession';
import {
  writeAuditLogFromRequest,
  AUDIT_CATEGORIES,
  AUDIT_ACTIONS,
  AUDIT_STATUS,
  AUDIT_SOURCE,
} from '../../../../lib/services/auditLog';
import { jobService } from '../../../../lib/supabase/database';
import { refreshTechnicianHoursForJobId } from '../../../../lib/supabase/technicianHours';
import { sendJobCompletedNotification } from '../../../../lib/email/sendJobCompletedNotification';
import { isJobStatusCompleted } from '../../../../lib/jobs/isJobStatusCompleted';
import { aifmCustomerNameForImport } from '../../../../lib/utils/aifmJobCustomerName';
import {
  findCustomerByName,
  findCustomerByTokenOverlap,
  resolveCustomerFromSapLeadMasterlist,
} from '../../../../lib/integrations/aifmAssignCustomersCore';
import { resolveOrCreatePlaceholderCustomer } from '../../../../lib/utils/aifmPortalPlaceholderCustomer';
import { formatAifmLocation, sanitizeAifmEmbeddedTagValue } from '../../../../lib/utils/aifmLocationFormat';
import { parseAifmAssignedTeches } from '../../../../lib/utils/aifmAssignedTechs';
import { matchTechnicianToAifmName } from '../../../../lib/utils/aifmTechnicianResolve';
import { authorizeAifmBearer, fetchAifmCustomersDirectory } from '../../../../lib/integrations/aifmApiClient';
import { enrichAifmJobsWithCustomerDirectory } from '../../../../lib/integrations/aifmCustomerAccountEnrichment';
import { syncPortalContactsFromMasterlist } from '../../../../lib/customers/syncPortalContactsFromMasterlist';
import {
  parseAifmDateTime,
  computeAifmWorkEndIso,
  aifmDurationDecimalHours,
  sortAifmJobsForJobNumberAssignment,
} from '../../../../lib/utils/aifmJobScheduleTimes';
import { applyAifmSapIdentifiers } from '../../../../lib/integrations/aifmSapIdentifiers';
import { getNextJobNumber } from '../../../../lib/jobs/getNextJobNumber';

export const config = { api: { responseLimit: false, bodyParser: { sizeLimit: '20mb' } } };

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map AIFM job_priority to DB priority values.
 * AIFM: "normal" | "high" | "low" | "urgent"
 * DB:   "MEDIUM" | "HIGH" | "LOW" | "URGENT"
 */
function mapPriority(value) {
  const v = (value || '').toString().trim().toLowerCase();
  if (v === 'low') return 'LOW';
  if (v === 'high') return 'HIGH';
  if (v === 'urgent') return 'URGENT';
  return 'MEDIUM'; // normal / empty / unknown → MEDIUM
}

/** Escape for safe use inside RegExp construction. */
function regexEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AIFM_DEDUP_FETCH_CAP = 80;

/**
 * Collect job rows linked to this AIFM id (marker in description and/or title pattern).
 */
async function fetchAllAifmLinkedJobs(supabase, aifmId) {
  const marker = `[AIFM:${aifmId}]`;
  const { data: byMarker } = await supabase
    .from('jobs')
    .select('id, job_number, description, title, created_at, updated_at')
    .ilike('description', `%${marker}%`)
    .is('deleted_at', null)
    .limit(AIFM_DEDUP_FETCH_CAP);

  const { data: byTitle } = await supabase
    .from('jobs')
    .select('id, job_number, description, title, created_at, updated_at')
    .ilike('title', `AIFM Job ${aifmId}%`)
    .is('deleted_at', null)
    .limit(AIFM_DEDUP_FETCH_CAP);

  const re = new RegExp(`^AIFM Job ${regexEscape(aifmId)}($| /)`, 'i');
  const map = new Map();
  for (const row of [...(byMarker || []), ...(byTitle || [])]) {
    if (!row?.id) continue;
    const titleOk = row.title && re.test(String(row.title).trim());
    const descOk = row.description && String(row.description).includes(marker);
    if (!titleOk && !descOk) continue;
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()];
}

function aifmJobRecencyTs(row) {
  const u = row.updated_at ? new Date(row.updated_at).getTime() : 0;
  const c = row.created_at ? new Date(row.created_at).getTime() : 0;
  return { primary: u || c, secondary: c };
}

/**
 * If several jobs match the same AIFM id, keep the latest (updated_at, then created_at)
 * and soft-remove the rest with light cleanup so duplicates do not linger.
 */
async function resolveAifmDuplicateJobs(supabase, aifmId, log) {
  const rows = await fetchAllAifmLinkedJobs(supabase, aifmId);
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  rows.sort((a, b) => {
    const ta = aifmJobRecencyTs(a);
    const tb = aifmJobRecencyTs(b);
    if (tb.primary !== ta.primary) return tb.primary - ta.primary;
    return tb.secondary - ta.secondary;
  });

  const [canonical, ...stale] = rows;
  const now = new Date().toISOString();

  for (const row of stale) {
    try {
      await supabase.from('job_schedule').delete().eq('job_id', row.id);
      await supabase.from('job_category').delete().eq('job_id', row.id);
      await supabase
        .from('technician_jobs')
        .update({ deleted_at: now })
        .eq('job_id', row.id)
        .is('deleted_at', null);
      await supabase.from('jobs').update({ deleted_at: now }).eq('id', row.id);
      log?.(
        `⚠ duplicate AIFM ${aifmId}: removed stale job ${row.job_number} (${row.id}); canonical ${canonical.job_number}`
      );
    } catch (e) {
      console.warn(`[aifm-import] duplicate cleanup failed for ${row.id}: ${e?.message}`);
    }
  }

  return canonical;
}

/**
 * Resolve customer — Tier 1 / 1b / 2, then placeholder (Tier 3) when no masterlist match.
 *
 * Returns null only when no display name can be derived (extremely rare — usually `AIFM job <id>`).
 */
async function resolveCustomer(job, supabase) {
  const aifmName = aifmCustomerNameForImport(job);

  // ── Tier 1: Supabase masterlist CardCode → look up in local DB ──────────
  // sap_card_code is kept as the import-compatible payload field, but it now
  // comes from the Supabase masterlist enrichment in jobs.js instead of SAP API.
  const cardCode = (job.sap_card_code || '').toString().trim();
  if (cardCode) {
    const { data: byCode } = await supabase
      .from('customer')
      .select('id, customer_code, customer_name')
      .eq('customer_code', cardCode)
      .is('deleted_at', null)
      .maybeSingle();
    if (byCode) {
      console.log(`[resolveCustomer] Tier1 hit: ${cardCode} → "${byCode.customer_name}"`);
      return byCode;
    }

    // ── Tier 1b: CardCode supplied by masterlist but not yet in local DB ───
    // This is mainly a race/fallback path; the masterlist row should normally
    // already exist in public.customer.
    const sapName = (job.sap_bp_card_name || aifmName || '').trim();
    if (sapName) {
      console.log(`[resolveCustomer] Tier1b: creating "${sapName}" (${cardCode}) from masterlist data`);
      const { data: created, error: createErr } = await supabase
        .from('customer')
        .insert({ customer_code: cardCode, customer_name: sapName })
        .select('id, customer_code, customer_name')
        .single();

      if (!createErr && created) {
        console.log(`[resolveCustomer] Tier1b created: ${created.id}`);
        return created;
      }
      console.warn(`[resolveCustomer] Tier1b insert error: ${createErr?.message} — retrying fetch`);
      // Race condition fallback: another worker may have inserted it
      const { data: retried } = await supabase
        .from('customer')
        .select('id, customer_code, customer_name')
        .eq('customer_code', cardCode)
        .is('deleted_at', null)
        .maybeSingle();
      if (retried) return retried;
    }
  }

  // ── Tier 2: Name search on portal customers (variants + token overlap) ──
  if (aifmName) {
    let tier2 = await findCustomerByName(aifmName, supabase);
    if (!tier2) {
      tier2 = await findCustomerByTokenOverlap(aifmName, supabase);
    }
    if (tier2) {
      console.log(`[resolveCustomer] Tier2: "${tier2.customer_name}" (${tier2.customer_code})`);
      return tier2;
    }
  }

  // ── Tier 2b: SAP Leads masterlist (sap_lead) — L* CardCode, not CP placeholder ──
  if (aifmName) {
    const tier2b = await resolveCustomerFromSapLeadMasterlist(aifmName, supabase);
    if (tier2b) {
      console.log(`[resolveCustomer] Tier2b SAP Lead: "${tier2b.customer_name}" (${tier2b.customer_code})`);
      return tier2b;
    }
  }

  // ── Tier 3: Placeholder customer (portal CP#####; same sequence as /dashboard/customers/create) ──
  if (aifmName) {
    const ph = await resolveOrCreatePlaceholderCustomer(aifmName, supabase);
    if (ph) {
      console.log(
        `[resolveCustomer] Tier3 placeholder: "${ph.customer_name}" (${ph.customer_code}) — portal CP format; link to masterlist CardCode when available`
      );
      return ph;
    }
  }

  console.log(
    `[resolveCustomer] no match for ${aifmName === null || aifmName === undefined ? '(no derived name)' : JSON.stringify(aifmName)} (cardCode=${cardCode || 'none'})`
  );
  return null;
}

/**
 * Find or create a location record for an AIFM job.
 * Works both WITH and WITHOUT a matched customer:
 *   - With customer  → scoped to (customer_id, location_name)
 *   - Without customer → scoped to (customer_id IS NULL, location_name)
 *     so the row can be claimed later when a customer is assigned.
 *
 * Requires migration: make_locations_customer_id_nullable.sql
 * Returns null only when locationName is empty.
 */
async function resolveOrCreateLocation(customer, locationName, supabase) {
  if (!locationName) return null;

  // Search for an existing record scoped to this customer (or unassigned)
  let query = supabase
    .from('locations')
    .select('id, location_name')
    .eq('location_name', locationName)
    .is('deleted_at', null);

  if (customer) {
    query = query.eq('customer_id', customer.id);
  } else {
    query = query.is('customer_id', null);
  }

  const { data: existing } = await query.maybeSingle();
  if (existing) return existing;

  const insertData = { location_name: locationName };
  if (customer) insertData.customer_id = customer.id;

  const { data: created, error } = await supabase
    .from('locations')
    .insert(insertData)
    .select('id, location_name')
    .single();

  if (error) throw new Error(`Failed to create location: ${error.message}`);
  return created;
}

/**
 * Look up technician UUIDs from AIFM assigned_teches.
 * Loads active technicians once; matches by exact normalized name, then all-token overlap (order-independent),
 * then a narrow substring fallback — see lib/utils/aifmTechnicianResolve.js. Does NOT create missing technicians.
 */
async function resolveTechnicianIds(assignedTeches, supabase) {
  const teches =
    typeof assignedTeches === 'string'
      ? parseAifmAssignedTeches(assignedTeches)
      : Array.isArray(assignedTeches)
      ? assignedTeches
      : [];

  if (!teches.length) return [];

  const { data: rows, error } = await supabase
    .from('technicians')
    .select('id, full_name')
    .is('deleted_at', null);

  if (error) {
    console.warn('[aifm-import] technicians list failed:', error.message);
    return [];
  }

  const technicians = rows || [];
  const ids = [];

  for (const t of teches) {
    const primary = (t.name || '').toString().trim();
    const raw = (t.raw || '').toString().trim();
    let m = primary ? matchTechnicianToAifmName(primary, technicians) : null;
    if (!m && raw && raw !== primary) {
      m = matchTechnicianToAifmName(raw, technicians);
    }
    if (m?.id) ids.push(m.id);
  }

  return [...new Set(ids)];
}

/**
 * Insert a job_schedule row using AIFM date/time + estimated duration fields.
 * Best-effort: logs warning on failure but does not throw.
 */
async function insertJobSchedule(jobId, job, supabase, address = null) {
  const startIso = parseAifmDateTime(job.job_start_date, job.job_start_time);
  const endIso = computeAifmWorkEndIso(job);
  const jsdate = startIso ? startIso.split('T')[0] : null;
  const jedate = endIso ? endIso.split('T')[0] : jsdate;
  const timeFromIso = (iso) =>
    iso ? (iso.split('T')[1] || '').split('.')[0] || null : null;

  const durationDecimal = aifmDurationDecimalHours(job);

  const { error } = await supabase.from('job_schedule').insert({
    job_id: jobId,
    jsdate,
    jedate,
    jstime: timeFromIso(startIso),
    jetime: timeFromIso(endIso),
    dur_type: 'hours',
    dur: durationDecimal,
    address: address || null,
  });
  if (error) {
    console.warn(`[aifm-import] job_schedule insert failed for ${jobId}: ${error.message}`);
  }
}

/**
 * Insert a job_category row from AIFM job_category field.
 * Best-effort: does not throw.
 */
async function insertJobCategory(jobId, job, supabase) {
  const cat = (job.job_category || '').toString().trim();
  if (!cat) return;
  const { error } = await supabase.from('job_category').insert({
    job_id: jobId,
    description: cat,
  });
  if (error) {
    console.warn(`[aifm-import] job_category insert failed for ${jobId}: ${error.message}`);
  }
}

/**
 * Core import loop (no HTTP session). Used by API handler and scripts/repair-aifm-jobs.mjs.
 */
export async function runAifmImportBatch(jobs, supabase, options = {}) {
  const send = typeof options.send === 'function' ? options.send : () => {};
  const log = typeof options.log === 'function' ? options.log : () => {};
  const enrichDirectory = options.enrichDirectory !== false;

  let created = 0;
  let updated = 0;
  let failed = 0;
  const results = [];

  send({ type: 'step', phase: 'start', message: `Importing ${jobs.length} job(s) into the database…` });
  log(`START — ${jobs.length} job(s)`);

  let batch = sortAifmJobsForJobNumberAssignment(jobs);
  log(`Job-number order: sorted ${batch.length} row(s) by scheduled_start (earliest first)`);

  if (enrichDirectory) {
    const aifmApiToken = (process.env.AIFM_API_TOKEN || '').trim().replace(/^["']|["']$/g, '');
    if (
      aifmApiToken &&
      batch.some(
        (j) =>
          j &&
          (j.id_customer ?? j.customer_id ?? j.idCustomer ?? j.customerId) != null &&
          !String(j.aifm_customer_account_name || '').trim()
      )
    ) {
      send({ type: 'step', phase: 'aifm_customers', message: 'Merging AIFM customer account names…' });
      try {
        const auth = await authorizeAifmBearer(process.env.AIFM_BASE_URL, aifmApiToken);
        if (auth) {
          const directoryRows = await fetchAifmCustomersDirectory(auth.base, auth.bearer);
          const merged = enrichAifmJobsWithCustomerDirectory(batch, directoryRows);
          batch = merged.jobs;
          log(
            `AIFM customer directory: size=${merged.directorySize} enriched=${merged.enrichedCount}/${batch.length}`
          );
        }
      } catch (e) {
        log(`⚠ AIFM customer directory skipped: ${e?.message || e}`);
      }
    }
  }

  for (let i = 0; i < batch.length; i++) {
    const job = batch[i];
    const aifmId = String(job.id ?? `row-${i + 1}`);

    send({
      type: 'progress',
      current: i + 1,
      total: batch.length,
      message: `Processing job ${i + 1} of ${batch.length} (AIFM ${aifmId})…`,
    });

    try {
      const customer = await resolveCustomer(job, supabase);
      const locationAddress = formatAifmLocation(job);
      const location = locationAddress
        ? await resolveOrCreateLocation(customer, locationAddress, supabase)
        : null;

      const scheduledStart = parseAifmDateTime(job.job_start_date, job.job_start_time);
      const scheduledEnd = computeAifmWorkEndIso(job);
      const aifmMarker = `[AIFM:${aifmId}]`;
      const existingJob = await resolveAifmDuplicateJobs(supabase, aifmId, log);

      const aifmDescription = (
        job.job_description ||
        job.description ||
        job.remarks ||
        job.note ||
        job.notes ||
        ''
      )
        .toString()
        .trim();

      const aifmDisplayName = aifmCustomerNameForImport(job);
      const customerTagLine = aifmDisplayName && sanitizeAifmEmbeddedTagValue(aifmDisplayName);
      const addressTagLine = locationAddress && sanitizeAifmEmbeddedTagValue(locationAddress);

      const description = [
        aifmMarker,
        customerTagLine ? `[CUSTOMER:${customerTagLine}]` : null,
        addressTagLine ? `[ADDRESS:${addressTagLine}]` : null,
        job.job_po_number ? `PO: ${job.job_po_number}` : null,
        aifmDescription || null,
      ]
        .filter(Boolean)
        .join('\n');

      const title = ['AIFM Job', aifmId, job.job_po_number ? `/ PO ${job.job_po_number}` : null]
        .filter(Boolean)
        .join(' ');

      const jobData = {
        customer_id: customer?.id ?? null,
        location_id: location?.id ?? null,
        service_call_id: null,
        title,
        description,
        priority: mapPriority(job.job_priority),
        status: String(job.status ?? '554'),
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd,
        created_by: null,
      };

      let savedJob;
      if (existingJob) {
        const previousStatus = existingJob.status;
        // Preserve portal-edited descriptions: AIFM only writes description on create.
        // Re-imports must not overwrite jobs.description (Edit Job / inline Job Details edits).
        const { description: _omitDescription, ...updateData } = jobData;
        savedJob = await jobService.update(existingJob.id, updateData, supabase);
        if (
          savedJob?.id &&
          isJobStatusCompleted(savedJob.status) &&
          !isJobStatusCompleted(previousStatus)
        ) {
          try {
            await sendJobCompletedNotification({
              supabase,
              jobId: savedJob.id,
              previousStatus,
            });
          } catch (emailErr) {
            console.warn('[import-jobs] sendJobCompletedNotification', emailErr?.message || emailErr);
          }
        }
        updated++;
        log(`↻ updated job ${existingJob.job_number} (AIFM ${aifmId})`);
      } else {
        savedJob = null;
        for (let attempt = 0; attempt < 5 && !savedJob; attempt++) {
          const jobNumber = await getNextJobNumber(supabase);
          try {
            savedJob = await jobService.create({ ...jobData, job_number: jobNumber }, supabase);
          } catch (e) {
            const isDup =
              e?.code === '23505' ||
              (typeof e?.message === 'string' && e.message.includes('jobs_job_number_key'));
            if (!isDup || attempt === 4) throw e;
          }
        }
        created++;
        log(`✓ created job ${savedJob.job_number} (AIFM ${aifmId})`);
      }

      if (existingJob) {
        await supabase.from('job_schedule').delete().eq('job_id', savedJob.id);
      }
      await insertJobSchedule(savedJob.id, job, supabase, locationAddress);

      if (!existingJob) {
        await insertJobCategory(savedJob.id, job, supabase);
      }

      const techIds = await resolveTechnicianIds(job.assigned_teches, supabase);
      if (techIds.length) {
        if (existingJob) {
          await supabase
            .from('technician_jobs')
            .update({ deleted_at: new Date().toISOString() })
            .eq('job_id', savedJob.id)
            .is('deleted_at', null);
        }
        await supabase.from('technician_jobs').insert(
          techIds.map((technician_id) => ({
            technician_id,
            job_id: savedJob.id,
            assignment_status: 'ASSIGNED',
          }))
        );
      }

      try {
        await refreshTechnicianHoursForJobId(supabase, savedJob.id);
      } catch (_) {}

      if (customer?.id) {
        try {
          await syncPortalContactsFromMasterlist(supabase, {
            customerId: customer.id,
            locationId: location?.id ?? null,
            locationName: locationAddress || null,
            aifmJob: job,
          });
        } catch (contactSyncErr) {
          log(`⚠ contacts sync AIFM ${aifmId}: ${contactSyncErr?.message || contactSyncErr}`);
        }
      }

      const personalJobId = job.personal_job_id ?? job.personal_id ?? null;
      const poNumber = job.job_po_number ?? null;
      if (personalJobId || poNumber) {
        try {
          const linkResult = await applyAifmSapIdentifiers({
            supabase,
            jobId: savedJob.id,
            customerId: customer?.id ?? null,
            personalJobId,
            poNumber,
            jobTitle: title,
          });
          if (linkResult.serviceCallId) {
            log(`  service_call ${personalJobId} → ${linkResult.serviceCallId}`);
          }
          if (linkResult.salesOrderId) {
            log(`  sales_order PO ${poNumber} → ${linkResult.salesOrderId}`);
          }
          if (linkResult.details?.serviceCall?.reason === 'missing_customer_id') {
            log(`  ⚠ service_call skipped (no customer_id) for AIFM ${aifmId}`);
          }
        } catch (idErr) {
          log(`⚠ SAP identifiers AIFM ${aifmId}: ${idErr?.message || idErr}`);
        }
      }

      results.push({
        aifmId,
        status: existingJob ? 'UPDATED' : 'CREATED',
        jobId: savedJob.id,
        jobNumber: savedJob.job_number,
      });
    } catch (err) {
      failed++;
      log(`✗ job ${aifmId} failed: ${err.message}`);
      results.push({ aifmId, status: 'FAILED', error: err.message });
    }
  }

  return { created, updated, failed, total: batch.length, results };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  let jobs = Array.isArray(body.jobs) ? [...body.jobs] : [];
  if (jobs.length === 0) {
    return res.status(400).json({ success: false, error: 'jobs array is required and must not be empty' });
  }

  // ── Commit to SSE stream ──────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  try { res.socket?.setNoDelay(true); } catch (_) {}

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  const tag = `[aifm/import-jobs ${new Date().toISOString()}]`;
  const log = (...args) => console.log(tag, ...args);

  const supabase = getSupabaseAdmin();

  try {
    const summary = await runAifmImportBatch(jobs, supabase, { send, log });
    log(`✓ DONE — ${JSON.stringify(summary)}`);

    await writeAuditLogFromRequest(req, {
      action: AUDIT_ACTIONS.AIFM_IMPORT,
      category: AUDIT_CATEGORIES.MIGRATION,
      description: `AIFM import: ${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`,
      details: {
        created: summary.created,
        updated: summary.updated,
        failed: summary.failed,
        total: summary.total,
      },
      status: summary.failed > 0 ? AUDIT_STATUS.WARNING : AUDIT_STATUS.SUCCESS,
      source: AUDIT_SOURCE.API,
    });

    send({ type: 'done', ...summary, results: summary.results.slice(0, 200) });
    res.end();
  } catch (e) {
    log('✗ FATAL:', e.message, e.stack?.split('\n')[1]);
    send({ type: 'error', error: e?.message || 'Import failed' });
    res.end();
  }
}

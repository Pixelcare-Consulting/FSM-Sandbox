import {
  applyMultiTokenIlikeFilters,
  parseSearchTokens,
  runWithConcurrency,
} from '../supabase/listQueryHelpers.js';
import { getSingaporeUtcDayRange } from '../utils/singaporeDateTime.js';
import { partitionSearchTokens } from './searchDateTokens.js';

const SUB_QUERY_LIMIT = 200;

const JOB_DIRECT_SEARCH_FIELDS = [
  'job_number',
  'title',
  'status',
  'description',
];

/**
 * Resolve customer-scoped job IDs for Job History search across jobs, locations,
 * schedule addresses, technicians, and scheduled dates.
 * Returns null when search is empty, [] when nothing matches, or string[] of job IDs.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} customerUUID
 * @param {string} searchQuery
 * @returns {Promise<null | string[]>}
 */
export async function resolveCustomerJobIdsForSearch(supabase, customerUUID, searchQuery) {
  const tokens = parseSearchTokens(searchQuery);
  if (tokens.length === 0) return null;

  const { dateTokens, textTokens } = partitionSearchTokens(tokens);

  let textIds = null;
  let dateIds = null;

  if (textTokens.length > 0) {
    textIds = await resolveTextJobIdsForCustomer(supabase, customerUUID, textTokens);
    if (textIds.length === 0) return [];
  }

  if (dateTokens.length > 0) {
    dateIds = await resolveJobIdsFromDates(supabase, customerUUID, dateTokens);
    if (dateIds.length === 0) return [];
  }

  if (textIds && dateIds) {
    const dateSet = new Set(dateIds);
    const intersected = textIds.filter((id) => dateSet.has(id));
    return intersected.length === 0 ? [] : intersected;
  }

  if (textIds) return textIds;
  if (dateIds) return dateIds;

  return [];
}

async function resolveTextJobIdsForCustomer(supabase, customerUUID, tokens) {
  const lookups = [
    () => resolveJobIdsFromJobsDirect(supabase, customerUUID, tokens),
    () => resolveJobIdsFromLocation(supabase, customerUUID, tokens),
    () => resolveJobIdsFromScheduleAddress(supabase, customerUUID, tokens),
    () => resolveJobIdsFromTechnician(supabase, customerUUID, tokens),
  ];

  const results = await runWithConcurrency(lookups, 6);
  const idSet = new Set();
  for (const ids of results) {
    for (const id of ids) {
      if (id) idSet.add(id);
    }
  }

  return [...idSet];
}

async function resolveJobIdsFromJobsDirect(supabase, customerUUID, tokens) {
  let query = supabase
    .from('jobs')
    .select('id')
    .is('deleted_at', null)
    .eq('customer_id', customerUUID);
  query = applyMultiTokenIlikeFilters(query, tokens, JOB_DIRECT_SEARCH_FIELDS);
  const { data, error } = await query.limit(SUB_QUERY_LIMIT);
  if (error) throw error;
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function resolveJobIdsFromLocation(supabase, customerUUID, tokens) {
  let locationQuery = supabase.from('locations').select('id');
  locationQuery = applyMultiTokenIlikeFilters(locationQuery, tokens, ['location_name']);

  const { data: locations, error } = await locationQuery.limit(SUB_QUERY_LIMIT);
  if (error) throw error;

  const locationIds = (locations || []).map((loc) => loc.id).filter(Boolean);
  if (locationIds.length === 0) return [];

  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id')
    .is('deleted_at', null)
    .eq('customer_id', customerUUID)
    .in('location_id', locationIds)
    .limit(SUB_QUERY_LIMIT);

  if (jobsError) throw jobsError;
  return (jobs || []).map((row) => row.id).filter(Boolean);
}

async function resolveJobIdsFromScheduleAddress(supabase, customerUUID, tokens) {
  let scheduleQuery = supabase.from('job_schedule').select('job_id');
  scheduleQuery = applyMultiTokenIlikeFilters(scheduleQuery, tokens, ['address']);

  const { data: schedules, error } = await scheduleQuery.limit(SUB_QUERY_LIMIT);
  if (error) throw error;

  const jobIds = (schedules || []).map((row) => row.job_id).filter(Boolean);
  if (jobIds.length === 0) return [];

  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id')
    .is('deleted_at', null)
    .eq('customer_id', customerUUID)
    .in('id', jobIds)
    .limit(SUB_QUERY_LIMIT);

  if (jobsError) throw jobsError;
  return (jobs || []).map((row) => row.id).filter(Boolean);
}

async function resolveJobIdsFromTechnician(supabase, customerUUID, tokens) {
  let technicianQuery = supabase.from('technicians').select('id');
  technicianQuery = applyMultiTokenIlikeFilters(technicianQuery, tokens, [
    'full_name',
    'sap_tech_code',
  ]);

  const { data: technicians, error } = await technicianQuery.limit(SUB_QUERY_LIMIT);
  if (error) throw error;

  const technicianIds = (technicians || []).map((t) => t.id).filter(Boolean);
  if (technicianIds.length === 0) return [];

  const { data: technicianJobs, error: tjError } = await supabase
    .from('technician_jobs')
    .select('job_id')
    .in('technician_id', technicianIds)
    .is('deleted_at', null)
    .limit(SUB_QUERY_LIMIT);

  if (tjError) throw tjError;

  const jobIds = (technicianJobs || []).map((row) => row.job_id).filter(Boolean);
  if (jobIds.length === 0) return [];

  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id')
    .is('deleted_at', null)
    .eq('customer_id', customerUUID)
    .in('id', jobIds)
    .limit(SUB_QUERY_LIMIT);

  if (jobsError) throw jobsError;
  return (jobs || []).map((row) => row.id).filter(Boolean);
}

async function resolveJobIdsFromDates(supabase, customerUUID, dateTokens) {
  let matchingIds = null;

  for (const dateYmd of dateTokens) {
    const { start, end } = getSingaporeUtcDayRange(dateYmd);
    const { data, error } = await supabase
      .from('jobs')
      .select('id')
      .is('deleted_at', null)
      .eq('customer_id', customerUUID)
      .gte('scheduled_start', start.toISOString())
      .lte('scheduled_start', end.toISOString())
      .limit(SUB_QUERY_LIMIT);

    if (error) throw error;

    const ids = new Set((data || []).map((row) => row.id).filter(Boolean));
    if (matchingIds === null) {
      matchingIds = ids;
    } else {
      matchingIds = new Set([...matchingIds].filter((id) => ids.has(id)));
    }
  }

  return matchingIds ? [...matchingIds] : [];
}

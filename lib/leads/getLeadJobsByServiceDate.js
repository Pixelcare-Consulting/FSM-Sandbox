import { buildLeadLocationName } from '../utils/leadLocationName.js';
import { toSingaporeYmd } from '../utils/singaporeDateTime.js';
import { normalizeServiceDateYmd } from './normalizeServiceDateYmd.js';

function getLeadServiceDates(lead) {
  return {
    first: normalizeServiceDateYmd(lead?.first_service_date),
    second: normalizeServiceDateYmd(lead?.second_service_date),
    third: normalizeServiceDateYmd(lead?.third_service_date),
    fourth: normalizeServiceDateYmd(lead?.fourth_service_date),
  };
}

function matchJobsToServiceDates(jobs, dates) {
  const jobsByServiceDate = {};

  for (const job of jobs || []) {
    const jobDate = toSingaporeYmd(job.scheduled_start);
    if (!jobDate) continue;

    if (dates.first === jobDate) jobsByServiceDate.first = { id: job.id, job_number: job.job_number };
    else if (dates.second === jobDate) jobsByServiceDate.second = { id: job.id, job_number: job.job_number };
    else if (dates.third === jobDate) jobsByServiceDate.third = { id: job.id, job_number: job.job_number };
    else if (dates.fourth === jobDate) jobsByServiceDate.fourth = { id: job.id, job_number: job.job_number };
  }

  return jobsByServiceDate;
}

function hasAnyServiceDate(dates) {
  return Boolean(dates.first || dates.second || dates.third || dates.fourth);
}

async function fetchCustomerJobs(supabase, customerId, locationId) {
  let query = supabase
    .from('jobs')
    .select('id, job_number, scheduled_start')
    .eq('customer_id', customerId)
    .is('deleted_at', null);

  if (locationId != null) {
    query = query.eq('location_id', locationId);
  }

  const { data: jobs, error } = await query;
  if (error) {
    throw new Error(`Failed to load lead jobs: ${error.message}`);
  }

  return jobs || [];
}

export async function getLeadJobsByServiceDate(lead, options = {}) {
  if (!lead?.customer_id) {
    return {};
  }

  const supabase = options.supabase || (await import('../supabase/server.js')).getSupabaseAdmin();
  const customerId = options.customerId || lead.customer_id;
  const locationName = options.locationName || buildLeadLocationName(lead);

  let locationId = options.locationId ?? null;

  if (locationId == null && locationName) {
    const { data: location } = await supabase
      .from('locations')
      .select('id')
      .eq('customer_id', customerId)
      .eq('location_name', locationName)
      .is('deleted_at', null)
      .maybeSingle();

    locationId = location?.id ?? null;
  }

  const dates = getLeadServiceDates(lead);
  const jobsWithLocation = await fetchCustomerJobs(supabase, customerId, locationId);
  let jobsByServiceDate = matchJobsToServiceDates(jobsWithLocation, dates);

  const shouldRetryWithoutLocation =
    locationId != null &&
    hasAnyServiceDate(dates) &&
    Object.keys(jobsByServiceDate).length === 0;

  if (shouldRetryWithoutLocation) {
    const jobsWithoutLocation = await fetchCustomerJobs(supabase, customerId, null);
    jobsByServiceDate = matchJobsToServiceDates(jobsWithoutLocation, dates);
  }

  return jobsByServiceDate;
}

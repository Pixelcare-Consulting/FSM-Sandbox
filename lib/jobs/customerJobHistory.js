import { uniqueActiveTechnicianJobs } from './uniqueActiveTechnicianJobs';
import { resolveJobDisplayAddress } from './resolveJobDisplayAddress';
import { fetchTechnicianJobsByJobIds } from './jobListSummary';
import { CUSTOMER_LOCATION_DISPLAY_SELECT } from '../scheduler/schedulerQueries';
import { formatSingaporeTime } from '../utils/singaporeDateTime';
import { paginatedSelect } from '../supabase/listQueryHelpers';
import { resolveCustomerJobIdsForSearch } from './customerJobHistorySearch';

/** Flat job columns for customer history list (no nested technician_jobs). */
export const CUSTOMER_JOB_HISTORY_LIST_SELECT = `
  id,
  job_number,
  title,
  description,
  status,
  priority,
  scheduled_start,
  scheduled_end,
  location_id,
  customer_id,
  created_at,
  customer:customer_id(customer_name, customer_code),
  location:location_id(location_name, id)
`;

async function fetchJobScheduleByJobId(supabase, jobIds) {
  const scheduleByJobId = {};
  if (!jobIds.length) return scheduleByJobId;

  const chunkSize = 100;
  for (let i = 0; i < jobIds.length; i += chunkSize) {
    const idBatch = jobIds.slice(i, i + chunkSize);
    const { data: scheduleRows, error } = await supabase
      .from('job_schedule')
      .select('job_id, address, dur, dur_type')
      .in('job_id', idBatch);

    if (error) {
      console.warn('job_schedule fetch:', error.message);
      continue;
    }

    for (const row of scheduleRows || []) {
      if (row.job_id && !scheduleByJobId[row.job_id]) {
        scheduleByJobId[row.job_id] = {
          address: row.address || null,
          dur: row.dur ?? null,
          dur_type: row.dur_type ?? null,
        };
      }
    }
  }

  return scheduleByJobId;
}

const CUSTOMER_LOCATIONS_CACHE_TTL_MS = 60_000;
const customerLocationsCache = new Map();

function getCachedCustomerLocations(customerUUID) {
  const entry = customerLocationsCache.get(customerUUID);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    customerLocationsCache.delete(customerUUID);
    return null;
  }
  return entry.value;
}

function setCachedCustomerLocations(customerUUID, locations) {
  customerLocationsCache.set(customerUUID, {
    value: locations,
    expiresAt: Date.now() + CUSTOMER_LOCATIONS_CACHE_TTL_MS,
  });
}

async function fetchCustomerLocations(supabase, customerUUID) {
  if (!customerUUID) return [];

  const cached = getCachedCustomerLocations(customerUUID);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('customer_location')
    .select(CUSTOMER_LOCATION_DISPLAY_SELECT)
    .eq('customer_id', customerUUID)
    .order('site_id', { ascending: true });

  if (error) {
    console.warn('customer_location fetch:', error.message);
    return [];
  }

  const locations = data || [];
  setCachedCustomerLocations(customerUUID, locations);
  return locations;
}

export function formatCustomerJobHistoryRow(
  job,
  { scheduleByJobId = {}, customerLocations = [], technicianJobsByJobId = {} } = {}
) {
  const technicianJobs = technicianJobsByJobId[job.id] ?? [];
  const assignedWorkers = uniqueActiveTechnicianJobs(technicianJobs).map((tj) => ({
    workerId: tj.technician?.id || tj.technician_id,
    technician: tj.technician,
  }));

  let scheduledStart = null;
  let scheduledEnd = null;
  let appointmentTime = null;

  if (job.scheduled_start) {
    scheduledStart = new Date(job.scheduled_start);
    appointmentTime = formatSingaporeTime(job.scheduled_start, { hour12: true });
    if (job.scheduled_end) {
      scheduledEnd = new Date(job.scheduled_end);
    }
  }

  const scheduleMeta = scheduleByJobId[job.id];
  let durationHours = null;
  const durRaw = scheduleMeta?.dur;
  const durDecimal = durRaw != null && durRaw !== '' ? parseFloat(durRaw) : null;
  if (typeof durDecimal === 'number' && !isNaN(durDecimal) && durDecimal > 0) {
    durationHours = Math.round(durDecimal * 10) / 10;
  } else if (scheduledStart && scheduledEnd) {
    const durationMs = scheduledEnd - scheduledStart;
    durationHours = Math.round((durationMs / (1000 * 60 * 60)) * 10) / 10;
  }

  const appointmentTimeEnd = scheduledEnd
    ? formatSingaporeTime(job.scheduled_end, { hour12: true })
    : null;

  const locationRecord = job.location
    ? { locationName: job.location.location_name, id: job.location.id }
    : null;

  const displayAddress = resolveJobDisplayAddress(
    { ...job, location: locationRecord },
    { scheduleAddress: scheduleMeta?.address, customerLocations }
  );

  return {
    id: job.id,
    jobNumber: job.job_number,
    title: job.title,
    jobDescription: job.description,
    jobStatus: job.status,
    startDate: scheduledStart,
    endDate: scheduledEnd,
    appointmentTime,
    appointmentTimeEnd,
    estimatedDurationHours: durationHours,
    location: displayAddress
      ? { locationName: displayAddress, id: job.location?.id || null }
      : locationRecord,
    assignedWorkers,
    priority: job.priority,
    needsAifmAddress: !displayAddress && /\[AIFM:[^\]]+\]/.test(job.description || ''),
  };
}

/**
 * Paginated customer job history for HistoryTab.
 */
export async function fetchCustomerJobHistoryPage(supabase, customerUUID, options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(Math.max(1, Number(options.limit) || 20), 200);
  const search = String(options.search || '').trim();

  let jobIdFilter = null;
  if (search) {
    jobIdFilter = await resolveCustomerJobIdsForSearch(supabase, customerUUID, search);
    if (Array.isArray(jobIdFilter) && jobIdFilter.length === 0) {
      return {
        jobs: [],
        totalCount: 0,
        page,
        limit,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  const { data, totalCount } = await paginatedSelect(
    supabase,
    'jobs',
    CUSTOMER_JOB_HISTORY_LIST_SELECT,
    {
      page,
      limit,
      order: { column: 'created_at', ascending: false },
      filters: (query) => {
        let q = query.eq('customer_id', customerUUID);
        if (Array.isArray(jobIdFilter)) {
          q = q.in('id', jobIdFilter);
        }
        return q;
      },
    }
  );

  const jobIds = (data || []).map((job) => job.id).filter(Boolean);
  const [scheduleByJobId, customerLocations, technicianJobsByJobId] = await Promise.all([
    fetchJobScheduleByJobId(supabase, jobIds),
    fetchCustomerLocations(supabase, customerUUID),
    fetchTechnicianJobsByJobIds(supabase, jobIds),
  ]);

  const jobs = (data || []).map((job) =>
    formatCustomerJobHistoryRow(job, {
      scheduleByJobId,
      customerLocations,
      technicianJobsByJobId,
    })
  );

  return {
    jobs,
    totalCount,
    page,
    limit,
    fetchedAt: new Date().toISOString(),
  };
}

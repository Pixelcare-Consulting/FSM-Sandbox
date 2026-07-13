import { getListCache, setListCache } from "../supabase/listQueryHelpers";
import {
  buildEventFromAssignment,
  buildScheduleMap,
  pickActiveSchedule,
  shapeTechnicians,
} from "./technicianSchedulerUtils";
import { fetchCalendarEventsForRange } from "../calendar/calendarEvents";
import { normalizeScheduleRows } from "../technicians/employeeProfile";
import { jobDisplayCustomerName } from "../utils/embeddedCustomerName";
import { toSingaporeYmd } from "../utils/singaporeDateTime";
import { resolveJobSiteContactMeta } from "./schedulerSiteContact";

/** PostgREST puts `.in()` values in the URL; very large lists exceed limits and return 400. */
export const REST_IN_CHUNK = 100;

/**
 * PostgREST/Supabase default max-rows per request is 1000. A single unbounded select silently
 * drops older rows — the job list still loads those jobs, but the scheduler would not.
 */
export const TECHNICIAN_JOBS_PAGE_SIZE = 1000;
export const UNDATED_JOBS_LIMIT = 300;
export const CHUNK_FETCH_CONCURRENCY = 2;

export const JOB_SCHEDULE_SELECT =
  "id, job_id, jsdate, jstime, jedate, jetime, dur, dur_type, address, created_at, updated_at";

/** Slim technician_jobs rows for scheduler / calendar window fetches. */
export const TECHNICIAN_JOBS_SCHEDULER_SELECT = `
  id,
  job_id,
  technician_id,
  assignment_status,
  started_at,
  completed_at,
  updated_at,
  deleted_at,
  technician:technician_id ( id, full_name, email, user_id )
`;

/** Date-windowed jobs calendar — flat columns + minimal nested joins. */
export const JOBS_CALENDAR_EVENTS_SELECT = `
  id,
  title,
  job_name,
  subject_name,
  job_number,
  job_no,
  description,
  job_description,
  status,
  priority,
  category,
  created_at,
  updated_at,
  scheduled_start,
  scheduled_end,
  scheduled_date,
  service_call_id,
  customer_id,
  location_id,
  location:location_id ( id, location_name ),
  customer:customer_id ( id, customer_name ),
  service_call:service_call_id ( call_number )
`;

/** Slim select for scheduler grid cards — site contact resolved in buildSchedulerEventsPayload. */
export const JOBS_FOR_SCHEDULER_SELECT = `
  id,
  title,
  job_number,
  description,
  status,
  created_at,
  updated_at,
  scheduled_start,
  scheduled_end,
  customer_id,
  contact_id,
  location_id,
  location:location_id ( id, location_name ),
  customer:customer_id ( id, customer_name, phone_number, email ),
  service_call:service_call_id ( call_number ),
  sales_order:sales_order_id ( document_number )
`;

export const JOBS_FALLBACK_SELECT = `
  id,
  title,
  job_number,
  description,
  status,
  created_at,
  updated_at,
  scheduled_start,
  scheduled_end,
  customer_id,
  location_id,
  location:location_id ( id, location_name ),
  customer:customer_id ( id, customer_name ),
  service_call:service_call_id ( call_number ),
  sales_order:sales_order_id ( document_number )
`;

export const TECHNICIAN_SELECT = `
  id,
  user_id,
  full_name,
  email,
  status,
  color,
  user:users (
    role,
    status
  )
`;

export const TECHNICIAN_BY_ID_SELECT =
  "id, user_id, full_name, email, status, color, user:users(role, status)";

/** Shared columns for customer_location display / address resolution (scheduler, job history, portal). */
export const CUSTOMER_LOCATION_DISPLAY_SELECT =
  "id, customer_id, site_id, building, street, block, city, country_name, zip_code, address, address_type, location_id";

/** Slim rows for resolveJobDisplayAddress customer_location matching on scheduler cards. */
export const CUSTOMER_LOCATION_SCHEDULER_SELECT = CUSTOMER_LOCATION_DISPLAY_SELECT;

/** Slim contacts rows for scheduler site-contact resolution. */
export const CONTACTS_SCHEDULER_SELECT =
  "id, customer_id, customer_location_id, first_name, middle_name, last_name, tel1, tel2, email";

/** Server-side cache for technician roster (matches client STATIC_TECH_TTL_MS). */
export const SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY = "scheduler-technicians";
export const SCHEDULER_TECHNICIANS_SERVER_CACHE_TTL_MS = 15 * 60 * 1000;

export function chunkIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < unique.length; i += REST_IN_CHUNK) {
    chunks.push(unique.slice(i, i + REST_IN_CHUNK));
  }
  return chunks;
}

/**
 * Run chunked Supabase `.in()` fetches with capped concurrency (default 4).
 */
export async function fetchChunkedInParallel(chunks, fetchChunk, concurrency = CHUNK_FETCH_CONCURRENCY) {
  if (!chunks.length) return { data: [], error: null };
  const merged = [];
  for (let i = 0; i < chunks.length; i += concurrency) {
    const slice = chunks.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((batch) => fetchChunk(batch)));
    for (const result of results) {
      if (result.error) return { data: null, error: result.error };
      if (result.data?.length) merged.push(...result.data);
    }
  }
  return { data: merged, error: null };
}

export async function fetchCustomerLocationsByCustomerIds(supabase, customerIds = []) {
  const unique = [...new Set((customerIds || []).filter(Boolean))];
  if (!unique.length || !supabase) return {};

  const { data, error } = await fetchChunkedInParallel(chunkIds(unique), (batch) =>
    supabase.from("customer_location").select(CUSTOMER_LOCATION_SCHEDULER_SELECT).in("customer_id", batch)
  );
  if (error) throw error;

  const byCustomerId = {};
  for (const row of data || []) {
    if (!byCustomerId[row.customer_id]) byCustomerId[row.customer_id] = [];
    byCustomerId[row.customer_id].push(row);
  }
  return byCustomerId;
}

export async function fetchContactsByCustomerIds(supabase, customerIds = []) {
  const unique = [...new Set((customerIds || []).filter(Boolean))];
  if (!unique.length || !supabase) return {};

  const { data, error } = await fetchChunkedInParallel(chunkIds(unique), (batch) =>
    supabase.from("contacts").select(CONTACTS_SCHEDULER_SELECT).in("customer_id", batch)
  );
  if (error) throw error;

  const byCustomerId = {};
  for (const row of data || []) {
    if (!byCustomerId[row.customer_id]) byCustomerId[row.customer_id] = [];
    byCustomerId[row.customer_id].push(row);
  }
  return byCustomerId;
}

export async function fetchTechnicianJobsForJobIdsChunked(supabase, jobIds) {
  const chunks = chunkIds(jobIds);
  return fetchChunkedInParallel(chunks, (batch) =>
    supabase
      .from("technician_jobs")
      .select(TECHNICIAN_JOBS_SCHEDULER_SELECT)
      .in("job_id", batch)
      .is("deleted_at", null)
  );
}

export async function fetchJobsForSchedulerWindow(
  supabase,
  rangeStart,
  rangeEnd,
  selectFragment,
  { includeUndated = false } = {}
) {
  const byId = new Map();
  const addRows = (rows) => {
    for (const row of rows || []) {
      if (row?.id) byId.set(row.id, row);
    }
  };

  const queries = [
    supabase
      .from("jobs")
      .select(selectFragment)
      .is("deleted_at", null)
      .not("scheduled_start", "is", null)
      .gte("scheduled_start", rangeStart)
      .lte("scheduled_start", rangeEnd),
    supabase
      .from("jobs")
      .select(selectFragment)
      .is("deleted_at", null)
      .not("scheduled_start", "is", null)
      .lt("scheduled_start", rangeStart)
      .gte("scheduled_end", rangeStart),
  ];

  if (includeUndated) {
    queries.push(
      supabase
        .from("jobs")
        .select(selectFragment)
        .is("deleted_at", null)
        .is("scheduled_start", null)
        .order("created_at", { ascending: false })
        .limit(UNDATED_JOBS_LIMIT)
    );
  }

  const results = await Promise.all(queries);

  for (const result of results) {
    if (result.error) return { data: null, error: result.error };
    addRows(result.data);
  }

  return { data: [...byId.values()], error: null };
}

export async function fetchJobsByIdsChunked(supabase, jobIds, selectFragment) {
  const chunks = chunkIds(jobIds);
  return fetchChunkedInParallel(chunks, (batch) =>
    supabase
      .from("jobs")
      .select(selectFragment)
      .in("id", batch)
      .is("deleted_at", null)
  );
}

export async function fetchJobSchedulesByJobIdsChunked(supabase, jobIds) {
  const chunks = chunkIds(jobIds);
  return fetchChunkedInParallel(chunks, (batch) =>
    supabase.from("job_schedule").select(JOB_SCHEDULE_SELECT).in("job_id", batch)
  );
}

export async function fetchTechniciansByIdsChunked(supabase, techIds, selectColumns) {
  const chunks = chunkIds(techIds);
  return fetchChunkedInParallel(chunks, (batch) =>
    supabase.from("technicians").select(selectColumns).in("id", batch)
  );
}

export async function fetchTechnicianSchedulesByTechnicianIdsChunked(supabase, technicianIds) {
  const chunks = chunkIds(technicianIds);
  return fetchChunkedInParallel(chunks, (batch) =>
    supabase
      .from("technician_schedules")
      .select("*")
      .in("technician_id", batch)
      .is("deleted_at", null)
      .order("day_of_week", { ascending: true })
      .order("shift_number", { ascending: true })
  );
}

export async function fetchSchedulerTechnicians(supabase) {
  const techniciansResult = await supabase
    .from("technicians")
    .select(TECHNICIAN_SELECT)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  if (techniciansResult.error) {
    return { technicians: [], error: techniciansResult.error };
  }

  const filteredTechnicians = (techniciansResult.data || []).filter(
    (technician) => technician.user?.role === "TECHNICIAN"
  );
  const allTechnicianIds = filteredTechnicians.map((t) => t.id).filter(Boolean);

  let technicianScheduleRows = [];
  if (allTechnicianIds.length) {
    const technicianSchedulesResult = await fetchTechnicianSchedulesByTechnicianIdsChunked(
      supabase,
      allTechnicianIds
    );
    if (technicianSchedulesResult.error) {
      console.warn(
        "[SchedulerAPI] Failed to fetch technician employee schedules:",
        technicianSchedulesResult.error.message
      );
    } else {
      technicianScheduleRows = technicianSchedulesResult.data || [];
    }
  }

  const schedulesByTechnicianId = technicianScheduleRows.reduce((map, row) => {
    if (!map[row.technician_id]) map[row.technician_id] = [];
    map[row.technician_id].push(row);
    return map;
  }, {});

  const technicians = shapeTechnicians(filteredTechnicians).map((technician) => ({
    ...technician,
    employeeSchedule: normalizeScheduleRows(schedulesByTechnicianId[technician.id] || []),
  }));

  return { technicians, filteredTechnicians, error: null };
}

/**
 * Cached technician roster for scheduler API routes (shared by technicians + technician-data).
 */
export async function loadSchedulerTechniciansForApi(supabase) {
  const cached = getListCache(
    SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY,
    SCHEDULER_TECHNICIANS_SERVER_CACHE_TTL_MS
  );
  if (cached) return cached;

  const result = await fetchSchedulerTechnicians(supabase);
  if (!result.error) {
    setListCache(
      SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY,
      result,
      SCHEDULER_TECHNICIANS_SERVER_CACHE_TTL_MS
    );
  }
  return result;
}

/**
 * Cheap fingerprint for polling / If-None-Match style checks.
 */
export function computeSchedulerDataVersion({
  events = [],
  undatedAssignments = [],
  calendarEvents = [],
  assignments = [],
  schedules = [],
}) {
  let maxTs = 0;
  const bump = (value) => {
    if (!value) return;
    const ts = new Date(value).getTime();
    if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
  };

  for (const evt of events) {
    bump(evt.jobUpdatedAt);
    bump(evt.scheduleUpdatedAt);
    bump(evt.updated_at);
    bump(evt.start);
  }
  for (const row of assignments) {
    bump(row.updated_at);
  }
  for (const row of undatedAssignments) {
    bump(row.updated_at);
  }
  for (const row of calendarEvents) {
    bump(row.updated_at);
  }
  for (const row of schedules) {
    bump(row.updated_at);
  }

  return `${events.length}:${undatedAssignments.length}:${calendarEvents.length}:${maxTs}`;
}

export function buildSchedulerEventsPayload({
  assignmentsResult,
  jobsById,
  scheduleMap,
  technicians,
  allTechnicianRows,
  filteredTechnicians,
  techsById: initialTechsById,
  missingFromList,
  supabase,
}) {
  return (async () => {
    let techsById = initialTechsById || Object.fromEntries(allTechnicianRows.map((t) => [t.id, t]));
    let technicianRows = allTechnicianRows;

    if (missingFromList?.length > 0) {
      const { data: techsData, error: techsFetchError } = await fetchTechniciansByIdsChunked(
        supabase,
        missingFromList,
        TECHNICIAN_BY_ID_SELECT
      );
      if (techsFetchError) {
        console.warn(
          "[SchedulerAPI] Failed to fetch technicians for assignments:",
          techsFetchError.message
        );
      } else if (techsData?.length) {
        for (const t of techsData) techsById[t.id] = t;
        const filteredIds = new Set(filteredTechnicians.map((ft) => ft.id));
        technicianRows = [
          ...technicianRows,
          ...techsData.filter((t) => !filteredIds.has(t.id)),
        ];
      }
    }

    const techniciansById = new Map(technicians.map((t) => [t.id, t]));

    const customerIds = [
      ...new Set(
        Object.values(jobsById)
          .map((job) => job?.customer_id)
          .filter(Boolean)
      ),
    ];
    let customerLocationsByCustomerId = {};
    let contactsByCustomerId = {};
    if (customerIds.length > 0) {
      try {
        [customerLocationsByCustomerId, contactsByCustomerId] = await Promise.all([
          fetchCustomerLocationsByCustomerIds(supabase, customerIds),
          fetchContactsByCustomerIds(supabase, customerIds),
        ]);
      } catch (customerLocErr) {
        console.warn(
          "[SchedulerAPI] Failed to fetch customer_location/contacts for jobs:",
          customerLocErr.message
        );
      }
    }

    const enrichedAssignments = (assignmentsResult.data || []).map((assignment) => {
      const baseJob = jobsById[assignment.job_id] || null;
      const customerLocations = baseJob?.customer_id
        ? customerLocationsByCustomerId[baseJob.customer_id] || []
        : [];
      return {
        ...assignment,
        job: baseJob ? { ...baseJob, customerLocations } : null,
        technician: techsById[assignment.technician_id] || null,
      };
    });

    const undatedAssignments = [];
    let events = enrichedAssignments
      .map((assignment) => {
        const technicianResource = techniciansById.get(assignment.technician_id);
        const schedule = pickActiveSchedule(scheduleMap[assignment.job_id] || []);
        const event = buildEventFromAssignment(assignment, schedule, technicianResource);
        if (event && assignment.job) {
          const siteMeta = resolveJobSiteContactMeta(
            assignment.job,
            customerLocationsByCustomerId,
            contactsByCustomerId
          );
          event.meta = {
            ...event.meta,
            ...(siteMeta || {}),
            siteContactResolved: true,
          };
        }
        if (!event && assignment.job && assignment.technician) {
          undatedAssignments.push({
            assignmentId: assignment.id,
            jobId: assignment.job_id,
            jobNumber: assignment.job.job_number,
            jobTitle: assignment.job.title,
            jobStatus: assignment.job.status,
            technicianId: assignment.technician_id,
            technicianName: assignment.technician.full_name,
            assignmentStatus: assignment.assignment_status,
            customerName: jobDisplayCustomerName(assignment.job) || null,
          });
        }
        return event;
      })
      .filter(Boolean);

    if (Object.keys(jobsById).length > 0) {
      events = events.map((evt) => {
        const latestStatus = jobsById[evt.jobId]?.status;
        return latestStatus !== undefined ? { ...evt, jobStatus: latestStatus } : evt;
      });
    }

    return { events, undatedAssignments, technicianRows };
  })();
}

export async function fetchCalendarEventsForSchedulerRange(supabase, rangeStart, rangeEnd) {
  const calendarStartDate = rangeStart ? toSingaporeYmd(rangeStart) : null;
  const calendarEndDate = rangeEnd ? toSingaporeYmd(rangeEnd) : null;
  if (!calendarStartDate || !calendarEndDate) return { data: [], error: null };

  return fetchCalendarEventsForRange(supabase, {
    startDate: calendarStartDate,
    endDate: calendarEndDate,
  });
}

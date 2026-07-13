import { getSupabaseClient } from "../supabase/client";
import { jobService } from "../supabase/database";
import { buildEventFromAssignment, buildSchedulePayload } from "./technicianSchedulerUtils";
import { emitJobStakeholderNotifications } from "../notifications/jobStakeholderNotificationsClient";
import { emitJobAssignmentEmails, emitJobCompletedEmail } from "../notifications/transactionalJobEmailClient";
import {
  resolveJobStatusForDb,
  mapJobStatusToAssignmentStatus,
} from "../jobs/jobStatusPersistence";
import { formatDurationHoursForDb } from "../jobs/scheduleDuration";
import {
  refreshTechnicianHoursForJobId,
  upsertTechnicianHoursForTechnicianJobId,
} from "../supabase/technicianHours";

const ensureSupabase = () => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase client not available");
  }
  return supabase;
};

/** @type {Map<string, Promise<unknown>>} */
const inFlightFetches = new Map();

function rejectIfAborted(signal) {
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
  }
  return null;
}

/** Detach caller abort from the shared in-flight fetch; only stops awaiting. */
function awaitWithOptionalAbort(promise, signal) {
  const aborted = rejectIfAborted(signal);
  if (aborted) return aborted;
  if (!signal) return promise;

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function singleflight(requestKey, factory, signal) {
  let flight = inFlightFetches.get(requestKey);
  if (!flight) {
    flight = (async () => {
      try {
        return await factory();
      } finally {
        if (inFlightFetches.get(requestKey) === flight) {
          inFlightFetches.delete(requestKey);
        }
      }
    })();
    inFlightFetches.set(requestKey, flight);
  }
  return awaitWithOptionalAbort(flight, signal);
}

async function parseSchedulerApiError(response, fallbackMessage) {
  let message = fallbackMessage;
  try {
    const payload = await response.json();
    if (payload?.error) message = payload.error;
  } catch {
    // ignore JSON parse errors
  }
  throw new Error(message);
}

export const normalizeSchedulerTechnicians = (technicians = []) =>
  technicians.map((tech) => ({
    ...tech,
    resourceId: tech.resourceId || tech.id,
  }));

export const hydrateSchedulerEvents = (events = [], technicians = []) => {
  const techById = new Map(
    technicians.map((tech) => [String(tech.resourceId || tech.id), tech])
  );
  return events.map((event) => {
    const resourceId = event.resourceId || event.technicianId;
    const resource = techById.get(String(resourceId));
    return {
      ...event,
      resourceId,
      start: event.start ? new Date(event.start) : event.start,
      end: event.end ? new Date(event.end) : event.end,
      color: resource?.color || event.color || "#3b82f6",
    };
  });
};

export const hydrateSchedulerEvent = (event, technicians = []) => {
  const [hydrated] = hydrateSchedulerEvents([event], technicians);
  return hydrated;
};

export const fetchSchedulerTechnicians = async ({ signal } = {}) => {
  const requestKey = "/api/scheduler/technicians";
  return singleflight(
    requestKey,
    async () => {
      const response = await fetch(requestKey, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        await parseSchedulerApiError(response, "Unable to load technicians.");
      }
      return response.json();
    },
    signal
  );
};

export const fetchSchedulerWindowData = async (
  range,
  { includeUndated = false, dataVersion = null, signal } = {}
) => {
  const params = new URLSearchParams();
  if (range?.start) params.set("rangeStart", range.start);
  if (range?.end) params.set("rangeEnd", range.end);
  if (includeUndated) params.set("includeUndated", "true");
  if (dataVersion) params.set("dataVersion", dataVersion);
  const query = params.toString();
  const requestKey = `/api/scheduler/technician-data${query ? `?${query}` : ""}`;

  return singleflight(
    requestKey,
    async () => {
      const response = await fetch(requestKey, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        await parseSchedulerApiError(response, "Unable to load technician schedules.");
      }
      const payload = await response.json();
      if (payload.unchanged) {
        return payload;
      }
      return {
        ...payload,
        events: hydrateSchedulerEvents(payload.events || []),
        undatedAssignments: payload.undatedAssignments || [],
        calendarEvents: payload.calendarEvents || [],
      };
    },
    signal
  );
};

/** @deprecated Use fetchSchedulerTechnicians + fetchSchedulerWindowData */
export const fetchTechnicianSchedulerData = async (range, options = {}) => {
  const [techPayload, windowPayload] = await Promise.all([
    fetchSchedulerTechnicians(),
    fetchSchedulerWindowData(range, options),
  ]);
  return {
    technicians: techPayload.technicians || [],
    events: windowPayload.events || [],
    undatedAssignments: windowPayload.undatedAssignments || [],
    calendarEvents: windowPayload.calendarEvents || [],
    dataVersion: windowPayload.dataVersion,
    stats: {
      totalTechnicians: techPayload.technicians?.length || 0,
      ...windowPayload.stats,
    },
  };
};

export const findJobByNumber = async (jobNumber) => {
  if (!jobNumber) throw new Error("Job number is required");

  const supabase = ensureSupabase();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      `
        id,
        job_number,
        title,
        status,
        description,
        scheduled_start,
        scheduled_end,
        customer:customer_id ( customer_name, customer_address ),
        location:location_id ( location_name )
      `
    )
    .eq("job_number", jobNumber)
    .is("deleted_at", null)
    .single();

  if (error) throw error;
  return data;
};

const ensureScheduleRecord = async (supabase, { jobId, technicianName, address, start, end, scheduleId }) => {
  const payload = buildSchedulePayload(start, end, { jobId, technicianName, address });

  if (scheduleId) {
    const { error, data } = await supabase
      .from("job_schedule")
      .update(payload)
      .eq("id", scheduleId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("job_schedule").insert(payload).select().single();
  if (error) throw error;
  return data;
};

const fetchPrimarySchedule = async (supabase, jobId) => {
  const { data, error } = await supabase
    .from("job_schedule")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  return data;
};

export const assignTechnicianToJob = async ({
  jobId,
  technicianId,
  start,
  end,
  location,
  status = "SCHEDULED",
}) => {
  const supabase = ensureSupabase();

  const { data: technician, error: technicianError } = await supabase
    .from("technicians")
    .select("id, full_name, email, user_id")
    .eq("id", technicianId)
    .single();

  if (technicianError) throw technicianError;

  const { data: existingActive, error: existingErr } = await supabase
    .from("technician_jobs")
    .select(
      `
        *,
        technician:technician_id ( id, full_name, email ),
        job:job_id (
          id,
          title,
          job_number,
          description,
          status,
          scheduled_start,
          scheduled_end,
          customer:customer_id ( customer_name ),
          location:location_id ( location_name )
        )
      `
    )
    .eq("job_id", jobId)
    .eq("technician_id", technicianId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingErr && existingErr.code !== "PGRST116") throw existingErr;

  if (existingActive) {
    const existingSchedule = await fetchPrimarySchedule(supabase, jobId);
    const scheduleRecord = await ensureScheduleRecord(supabase, {
      jobId,
      technicianName: technician.full_name,
      address: location,
      start,
      end,
      scheduleId: existingSchedule?.id,
    });

    await supabase
      .from("jobs")
      .update({ scheduled_start: start.toISOString(), scheduled_end: end.toISOString() })
      .eq("id", jobId);

    try {
      await refreshTechnicianHoursForJobId(supabase, jobId);
    } catch (e) {
      console.warn("refreshTechnicianHoursForJobId", e);
    }

    return buildEventFromAssignment(existingActive, scheduleRecord);
  }

  let isNewTechnicianAssignment = true;

  const { data: technicianJob, error: assignmentError } = await supabase
    .from("technician_jobs")
    .insert({
      technician_id: technicianId,
      job_id: jobId,
      assignment_status: status,
    })
    .select(
      `
        *,
        technician:technician_id ( id, full_name, email ),
        job:job_id (
          id,
          title,
          job_number,
          description,
          status,
          scheduled_start,
          scheduled_end,
          customer:customer_id ( customer_name ),
          location:location_id ( location_name )
        )
      `
    )
    .single();

  let assignment = technicianJob;

  if (assignmentError) {
    if (assignmentError.code === "23505") {
      isNewTechnicianAssignment = false;
      const { data: existing, error: fetchExistingError } = await supabase
        .from("technician_jobs")
        .select(
          `
            *,
            technician:technician_id ( id, full_name, email ),
            job:job_id (
              id,
              title,
              job_number,
              description,
              status,
              scheduled_start,
              scheduled_end,
              customer:customer_id ( customer_name ),
              location:location_id ( location_name )
            )
          `
        )
        .eq("job_id", jobId)
        .eq("technician_id", technicianId)
        .single();

      if (fetchExistingError) throw fetchExistingError;
      assignment = existing;
    } else {
      throw assignmentError;
    }
  }

  const existingSchedule = await fetchPrimarySchedule(supabase, jobId);
  const scheduleRecord = await ensureScheduleRecord(supabase, {
    jobId,
    technicianName: technician.full_name,
    address: location,
    start,
    end,
    scheduleId: existingSchedule?.id,
  });

  await supabase
    .from("jobs")
    .update({ scheduled_start: start.toISOString(), scheduled_end: end.toISOString() })
    .eq("id", jobId);

  if (isNewTechnicianAssignment && assignment?.job) {
    const j = assignment.job;
    if (technician?.user_id) {
      await emitJobStakeholderNotifications({
        assigneeUserIds: [technician.user_id],
        jobId: j.id,
        jobNumber: j.job_number,
        jobTitle: j.title,
        kind: "new",
      });
    }
    void emitJobAssignmentEmails({
      jobId: j.id,
      technicianIds: [technicianId],
    });
  }

  try {
    await refreshTechnicianHoursForJobId(supabase, jobId);
  } catch (e) {
    console.warn("refreshTechnicianHoursForJobId", e);
  }

  return buildEventFromAssignment(assignment, scheduleRecord);
};

/**
 * Reassign a job to a different technician WITHOUT touching the scheduled times.
 *
 * Appointment display uses jobs.scheduled_end (canonical). job_schedule.jetime can drift
 * if only one table was updated; reassign must not write display-derived times back to DB.
 */
export const reassignTechnician = async ({
  technicianJobId,
  jobId,
  technicianId,
}) => {
  const supabase = ensureSupabase();

  const { data: technician, error: technicianError } = await supabase
    .from("technicians")
    .select("id, full_name, email")
    .eq("id", technicianId)
    .single();

  if (technicianError) throw technicianError;

  const { data, error } = await supabase
    .from("technician_jobs")
    .update({ technician_id: technicianId })
    .eq("id", technicianJobId)
    .select(
      `
        *,
        technician:technician_id ( id, full_name, email ),
        job:job_id (
          id,
          title,
          job_number,
          description,
          status,
          scheduled_start,
          scheduled_end,
          customer:customer_id ( customer_name ),
          location:location_id ( location_name )
        )
      `
    )
    .single();

  if (error) throw error;

  try {
    await upsertTechnicianHoursForTechnicianJobId(supabase, technicianJobId);
  } catch (e) {
    console.warn("upsertTechnicianHoursForTechnicianJobId", e);
  }

  void emitJobAssignmentEmails({
    jobId,
    technicianIds: [technicianId],
  });

  // Keep job_schedule.job_tech in sync with the new assignee so the schedule label matches,
  // but leave jsdate/jstime/jedate/jetime/dur untouched.
  const primarySchedule = await fetchPrimarySchedule(supabase, jobId);
  if (primarySchedule?.id) {
    const { data: updatedSchedule, error: schedError } = await supabase
      .from("job_schedule")
      .update({ job_tech: technician.full_name || null })
      .eq("id", primarySchedule.id)
      .select()
      .single();
    if (schedError) throw schedError;
    return buildEventFromAssignment(data, updatedSchedule);
  }

  return buildEventFromAssignment(data, primarySchedule);
};

export const updateTechnicianSchedule = async ({
  technicianJobId,
  jobId,
  scheduleId,
  technicianId,
  start,
  end,
  location,
}) => {
  const supabase = ensureSupabase();

  const { data: technician, error: technicianError } = await supabase
    .from("technicians")
    .select("id, full_name, email")
    .eq("id", technicianId)
    .single();

  if (technicianError) throw technicianError;

  const resolvedScheduleId = scheduleId || (await fetchPrimarySchedule(supabase, jobId))?.id;
  const scheduleRecord = await ensureScheduleRecord(supabase, {
    jobId,
    technicianName: technician.full_name,
    address: location,
    start,
    end,
    scheduleId: resolvedScheduleId,
  });

  await supabase
    .from("jobs")
    .update({ scheduled_start: start.toISOString(), scheduled_end: end.toISOString() })
    .eq("id", jobId);

  const { data, error } = await supabase
    .from("technician_jobs")
    .update({
      technician_id: technicianId,
    })
    .eq("id", technicianJobId)
    .select(
      `
        *,
        technician:technician_id ( id, full_name, email ),
        job:job_id (
          id,
          title,
          job_number,
          description,
          status,
          scheduled_start,
          scheduled_end,
          customer:customer_id ( customer_name ),
          location:location_id ( location_name )
        )
      `
    )
    .single();

  if (error) throw error;

  try {
    await refreshTechnicianHoursForJobId(supabase, jobId);
  } catch (e) {
    console.warn("refreshTechnicianHoursForJobId", e);
  }

  return buildEventFromAssignment(data, scheduleRecord);
};

const TECHNICIAN_JOB_SELECT = `
  *,
  technician:technician_id ( id, full_name, email ),
  job:job_id (
    id,
    title,
    job_number,
    description,
    status,
    scheduled_start,
    scheduled_end,
    customer:customer_id ( customer_name ),
    location:location_id ( location_name )
  )
`;

const fetchTechnicianJobById = async (supabase, technicianJobId) => {
  const { data, error } = await supabase
    .from("technician_jobs")
    .select(TECHNICIAN_JOB_SELECT)
    .eq("id", technicianJobId)
    .single();

  if (error) throw error;
  return data;
};

export const updateJobStatusFromScheduler = async ({
  jobId,
  technicianJobId,
  status,
  previousStatus,
  jobStatuses = [],
}) => {
  const supabase = ensureSupabase();

  const resolvedStatus =
    resolveJobStatusForDb(status, jobStatuses) ||
    resolveJobStatusForDb(previousStatus, jobStatuses) ||
    String(previousStatus || "");

  const previousResolved =
    resolveJobStatusForDb(previousStatus, jobStatuses) || String(previousStatus || "");
  const wasComplete = mapJobStatusToAssignmentStatus(previousResolved) === "COMPLETED";
  const isNowComplete = mapJobStatusToAssignmentStatus(resolvedStatus) === "COMPLETED";

  const updatedJob = await jobService.update(jobId, { status: resolvedStatus }, supabase);

  const newAssignmentStatus = mapJobStatusToAssignmentStatus(resolvedStatus);
  const { error: assignmentError } = await supabase
    .from("technician_jobs")
    .update({ assignment_status: newAssignmentStatus })
    .eq("job_id", jobId)
    .is("deleted_at", null);

  if (assignmentError) throw assignmentError;

  void emitJobStakeholderNotifications({
    jobId,
    jobNumber: updatedJob?.job_number,
    jobTitle: updatedJob?.title,
    assigneeUserIds: [],
    kind: "updated",
  });

  if (isNowComplete && !wasComplete) {
    void emitJobCompletedEmail({
      jobId,
      previousStatus: previousResolved,
    });
  }

  void fetch("/api/jobs/sync-to-sap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
    credentials: "include",
  })
    .then((r) => {
      if (!r.ok) console.warn("SAP job sync failed");
    })
    .catch((e) => console.warn("SAP job sync error", e));

  const assignment = await fetchTechnicianJobById(supabase, technicianJobId);
  const primarySchedule = await fetchPrimarySchedule(supabase, jobId);

  return buildEventFromAssignment(assignment, primarySchedule);
};

export const rescheduleJobAppointment = async ({
  jobId,
  jobScheduleId,
  technicianJobId,
  technicianId,
  start,
  end,
  location,
  durationHours,
  durationMinutes,
}) => {
  const supabase = ensureSupabase();

  const hasAppointmentChange = start instanceof Date && end instanceof Date;
  const hasDurationChange =
    durationHours !== undefined || durationMinutes !== undefined;

  if (!hasAppointmentChange && !hasDurationChange) {
    throw new Error("No schedule changes to save.");
  }

  let scheduleRecord = null;

  if (hasAppointmentChange) {
    const { data: technician, error: technicianError } = await supabase
      .from("technicians")
      .select("id, full_name, email")
      .eq("id", technicianId)
      .single();

    if (technicianError) throw technicianError;

    const resolvedScheduleId =
      jobScheduleId || (await fetchPrimarySchedule(supabase, jobId))?.id;

    scheduleRecord = await ensureScheduleRecord(supabase, {
      jobId,
      technicianName: technician.full_name,
      address: location,
      start,
      end,
      scheduleId: resolvedScheduleId,
    });

    await supabase
      .from("jobs")
      .update({
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
      })
      .eq("id", jobId);
  }

  if (hasDurationChange) {
    const durDecimal = formatDurationHoursForDb(durationHours, durationMinutes);
    let resolvedScheduleId =
      scheduleRecord?.id ||
      jobScheduleId ||
      (await fetchPrimarySchedule(supabase, jobId))?.id;

    if (!resolvedScheduleId) {
      const { data: jobRow, error: jobError } = await supabase
        .from("jobs")
        .select("scheduled_start, scheduled_end")
        .eq("id", jobId)
        .single();

      if (jobError) throw jobError;

      if (jobRow?.scheduled_start && jobRow?.scheduled_end) {
        const { data: technician, error: technicianError } = await supabase
          .from("technicians")
          .select("id, full_name")
          .eq("id", technicianId)
          .single();

        if (technicianError) throw technicianError;

        scheduleRecord = await ensureScheduleRecord(supabase, {
          jobId,
          technicianName: technician?.full_name,
          address: location,
          start: new Date(jobRow.scheduled_start),
          end: new Date(jobRow.scheduled_end),
        });
        resolvedScheduleId = scheduleRecord?.id;
      }
    }

    if (resolvedScheduleId) {
      const { data: updatedSchedule, error: durError } = await supabase
        .from("job_schedule")
        .update({
          dur_type: "hours",
          dur: durDecimal,
        })
        .eq("id", resolvedScheduleId)
        .select()
        .single();

      if (durError) throw durError;
      scheduleRecord = updatedSchedule;
    }
  }

  if (!scheduleRecord) {
    scheduleRecord = await fetchPrimarySchedule(supabase, jobId);
  }

  try {
    await refreshTechnicianHoursForJobId(supabase, jobId);
  } catch (e) {
    console.warn("refreshTechnicianHoursForJobId", e);
  }

  const assignment = await fetchTechnicianJobById(supabase, technicianJobId);
  return buildEventFromAssignment(assignment, scheduleRecord);
};

export const updateTechnicianColor = async (technicianId, color) => {
  const response = await fetch(`/api/technicians/${technicianId}/color`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ color }),
  });

  if (!response.ok) {
    let message = "Unable to update technician color.";
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch (error) {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  const payload = await response.json();
  return payload;
};


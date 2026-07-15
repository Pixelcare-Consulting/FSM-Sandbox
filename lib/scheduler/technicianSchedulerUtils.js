import format from "date-fns/format";
import parseISO from "date-fns/parseISO";
import isValid from "date-fns/isValid";
import { jobDisplayCustomerName } from "../utils/embeddedCustomerName";
import {
  buildSingaporeDateTimeFromForm,
  formatSingaporeTimeHm,
  toSingaporeYmd,
} from "../utils/singaporeDateTime";
import { resolveJobDisplayAddress } from "../jobs/resolveJobDisplayAddress";
import { sanitizeAddressPart } from "../utils/formatPortalBpAddress";

export const TECHNICIAN_COLORS = [
  "#1aaa55",
  "#7fa900",
  "#f57f17",
  "#357cd2",
  "#7460ee",
  "#e91e63",
  "#00bdae",
  "#ff6c00",
  "#5e35b1",
  "#c62828",
];

export const ASSIGNMENT_STATUSES = [
  "ASSIGNED",
  "STARTED",
  "COMPLETED",
  "PENDING",
  "CREATED",
  "IN_PROGRESS",
  "UPCOMING",
  "OVERDUE",
  "WAITING",
  "SCHEDULED",
  "RESCHEDULED",
];

/** Colors for technician/assignment status on scheduler cards (confirmed, unconfirmed, completed, cancelled) */
export const TECHNICIAN_STATUS_COLORS = {
  ASSIGNED: "#3b82f6",   // blue – confirmed
  STARTED: "#f59e0b",     // amber – in progress
  COMPLETED: "#22c55e",   // green – completed
  CANCELLED: "#6b7280",   // gray – cancelled
  PENDING: "#f97316",    // orange – unconfirmed
  CREATED: "#8b5cf6",
  IN_PROGRESS: "#f59e0b",
  SCHEDULED: "#3b82f6",
  RESCHEDULED: "#8b5cf6",
  UPCOMING: "#0ea5e9",
  OVERDUE: "#ef4444",
  WAITING: "#f97316",
};

export const getTechnicianStatusColor = (status) => {
  if (!status) return "#3b82f6";
  const key = String(status).toUpperCase().replace(/\s+/g, "_");
  return TECHNICIAN_STATUS_COLORS[key] || "#3b82f6";
};

export const getTechnicianStatusLabel = (status) => {
  if (!status) return "N/A";
  const labels = {
    ASSIGNED: "Assigned",
    STARTED: "Started",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    PENDING: "Unconfirmed",
    CREATED: "Created",
    IN_PROGRESS: "In Progress",
    SCHEDULED: "Scheduled",
    RESCHEDULED: "Rescheduled",
    UPCOMING: "Upcoming",
    OVERDUE: "Overdue",
    WAITING: "Waiting",
  };
  const key = String(status).toUpperCase().replace(/\s+/g, "_");
  return labels[key] || status;
};

export const parseDateTime = (dateValue, timeValue) => {
  if (!dateValue) return null;
  try {
    if (dateValue instanceof Date) {
      return isValid(dateValue) ? dateValue : null;
    }

    if (typeof dateValue === "string" && (dateValue.includes("T") || dateValue.includes(" "))) {
      const parsed = parseISO(dateValue);
      return isValid(parsed) ? parsed : null;
    }

    const safeTime = (timeValue || "00:00:00").substring(0, 8);
    const sgDate = buildSingaporeDateTimeFromForm(dateValue, safeTime.substring(0, 5));
    if (sgDate) return sgDate;
    const combined = `${dateValue}T${safeTime}`;
    const parsed = parseISO(combined);
    return isValid(parsed) ? parsed : null;
  } catch (error) {
    console.warn("scheduler.parseDateTime", error);
    return null;
  }
};

export const formatDatePart = (date, pattern) => {
  if (!(date instanceof Date) || !isValid(date)) return null;
  return format(date, pattern);
};

export const buildSchedulePayload = (start, end, { jobId, technicianName, address }) => ({
  job_id: jobId,
  jsdate: toSingaporeYmd(start) || formatDatePart(start, "yyyy-MM-dd"),
  jstime: `${formatSingaporeTimeHm(start) || formatDatePart(start, "HH:mm")}:00`,
  jedate: toSingaporeYmd(end) || formatDatePart(end, "yyyy-MM-dd"),
  jetime: `${formatSingaporeTimeHm(end) || formatDatePart(end, "HH:mm")}:00`,
  job_tech: technicianName || null,
  address: address || null,
});

export const shapeTechnicians = (rows = []) =>
  rows.map((technician, index) => {
    const sourceStatus = technician.user?.status || technician.status;
    const status = sourceStatus ? String(sourceStatus).toUpperCase() : "ACTIVE";
    const statusLabel = status
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

    return {
      id: technician.id,
      workerId: technician.user_id || null,
      text: technician.full_name || "Unnamed Technician",
      subtext: technician.email || "",
      color: technician.color || TECHNICIAN_COLORS[index % TECHNICIAN_COLORS.length], // Use database color if available, otherwise default
      status,
      statusLabel,
      isActive: status === "ACTIVE",
      raw: technician,
    };
  });

export const buildScheduleMap = (rows = []) =>
  rows.reduce((acc, schedule) => {
    if (!acc[schedule.job_id]) acc[schedule.job_id] = [];
    acc[schedule.job_id].push(schedule);
    return acc;
  }, {});

export const pickActiveSchedule = (schedules = []) => {
  if (!schedules.length) return null;

  return [...schedules].sort((a, b) => {
    const aDate = parseDateTime(a.jsdate, a.jstime) || new Date(a.created_at || 0);
    const bDate = parseDateTime(b.jsdate, b.jstime) || new Date(b.created_at || 0);
    return aDate - bDate;
  })[0];
};

const normalizeSchedulerLocation = (value) => {
  const raw = sanitizeAddressPart(value);
  if (!raw) return "";

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/^singapore$/i.test(part) ? "Singapore" : part));

  if (parts.length < 2) return parts.join(", ");

  const firstPart = parts[0].replace(/^unit\s+/i, "").trim();
  const looksLikeLeadingUnit = /^#?\s*[A-Za-z0-9]+-\s*[A-Za-z0-9]+$/i.test(firstPart);

  if (looksLikeLeadingUnit) {
    return [parts[1], firstPart, ...parts.slice(2)].filter(Boolean).join(", ");
  }

  return parts.join(", ");
};

/**
 * Service address for scheduler cards — same priority as Job Page (linked location first).
 */
export const buildLocation = (schedule, job) => {
  const resolved = resolveJobDisplayAddress(
    {
      description: job?.description,
      location: job?.location,
      location_id: job?.location_id,
    },
    {
      scheduleAddress: schedule?.address,
      customerLocations: job?.customerLocations,
    }
  );
  if (resolved) return normalizeSchedulerLocation(resolved);

  const custAddr = (job?.customer?.customer_address || "").toString().trim();
  if (custAddr) return normalizeSchedulerLocation(job.customer.customer_address);
  return "No Location";
};

export const buildEventFromAssignment = (assignment, schedule, technicianResource) => {
  const job = assignment.job;
  const technician = assignment.technician;

  if (!job || !technician) return null;

  // For start time, prioritize job.scheduled_start if it exists.
  // This handles cases where EditJobs updates jobs.scheduled_start but not job_schedule.
  // NOTE: job.created_at is intentionally NOT used as a fallback — it would position
  // the event on the wrong day (job creation date ≠ scheduled date), causing the event
  // to be invisible when the user views the actual scheduled day.
  const scheduleStartTime = parseDateTime(schedule?.jsdate, schedule?.jstime);
  const jobStartTime = parseDateTime(job.scheduled_start);

  const startTime = jobStartTime || scheduleStartTime ||
    parseDateTime(assignment.started_at) ||
    null;
  const scheduleEndTime = parseDateTime(schedule?.jedate, schedule?.jetime);
  const jobEndTime = parseDateTime(job.scheduled_end);

  const validJobEnd = jobEndTime && isValid(jobEndTime);
  const validSchedEnd = scheduleEndTime && isValid(scheduleEndTime);

  const durRaw = schedule?.dur;
  const durationHoursParsed = durRaw != null && durRaw !== "" ? parseFloat(durRaw) : null;
  const hasValidDuration =
    typeof durationHoursParsed === "number" && !isNaN(durationHoursParsed) && durationHoursParsed > 0;

  // Appointment window (e.g. 9am–12pm) is independent of estimated work duration (1–8h).
  // `jobs.scheduled_end` is the canonical customer slot (matches job details page).
  // Fall back to job_schedule.jetime only when scheduled_end is missing.
  let appointmentEnd = null;
  if (validJobEnd) {
    appointmentEnd = jobEndTime;
  } else if (validSchedEnd) {
    appointmentEnd = scheduleEndTime;
  }

  let workEndFromDuration = null;
  if (hasValidDuration && startTime && isValid(startTime)) {
    workEndFromDuration = new Date(
      startTime.getTime() + durationHoursParsed * 60 * 60 * 1000
    );
  }

  let endTime =
    appointmentEnd ||
    workEndFromDuration ||
    parseDateTime(assignment.completed_at) ||
    (startTime ? new Date(startTime.getTime() + 60 * 60 * 1000) : null);

  if (!startTime || !endTime || !isValid(startTime) || !isValid(endTime)) {
    return null;
  }

  const displayCustomer = jobDisplayCustomerName(job);
  return {
    event_id: assignment.id,
    title: job.title || job.job_number || "Untitled Job",
    subtitle: displayCustomer,
    start: startTime,
    end: endTime,
    appointmentEnd: appointmentEnd || endTime,
    workEnd: workEndFromDuration || undefined,
    durationHours: hasValidDuration ? durationHoursParsed : undefined,
    resourceId: technician.id,
    technicianId: technician.id,
    technicianJobId: assignment.id,
    jobId: job.id,
    jobNumber: job.job_number,
    jobScheduleId: schedule?.id ?? null,
    status: assignment.assignment_status,
    jobStatus: job.status ?? job.job_status ?? null,
    location: buildLocation(schedule, job),
    jobUpdatedAt: job.updated_at || null,
    scheduleUpdatedAt: schedule?.updated_at || null,
    color: technicianResource?.color,
    textColor: "#fff",
    draggable: true,
    editable: true,
    deletable: false,
    meta: {
      customerName: displayCustomer || "No Customer",
      description: job.description || "",
      technicianName: technician.full_name,
      technicianEmail: technician.email,
      serviceCallNumber: job.service_call?.call_number ?? null,
      salesOrderNumber: job.sales_order?.document_number ?? null,
    },
  };
};



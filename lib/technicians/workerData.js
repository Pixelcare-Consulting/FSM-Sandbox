import { buildTechnicianDisplayName } from "../../utils/technicianDisplayName";
import {
  TECHNICIAN_EMPLOYEE_TABLES,
  cloneDefaultWorkerSchedule,
  fetchTechnicianEmployeeProfile,
  normalizeScheduleRows,
} from "./employeeProfile";
import {
  assignmentPeriodAnchorMs,
  calculateTechnicianJobIncentive,
  fetchTechnicianJobsLaborInPeriod,
} from "../supabase/reports";
import { getFsmLaborPeriodTimezone, getFsmPeriodRangeMs } from "../supabase/technicianHours";
import { dedupeTechnicianJobRows } from "../supabase/dedupeTechnicianJobs";
import {
  chunkIds,
  fetchChunkedInParallel,
  fetchJobSchedulesByJobIdsChunked,
} from "../scheduler/schedulerQueries";
import {
  applyMultiTokenIlikeFilters,
  paginatedSelect,
  parseSearchTokens,
} from "../supabase/listQueryHelpers";

const CACHE_TTL_MS = 30000;
const cache = new Map();

const ATTENDANCE_SUMMARY_SELECT =
  "technician_id, clock_in, clock_out, is_break, technician_job_id";

function mapOpenPunchToSummary(row) {
  return {
    isWorking: true,
    isOnBreak: Boolean(row.is_break),
    attendanceClockIn: row.clock_in,
    attendanceClockOut: null,
    linkedTechnicianJobId: row.technician_job_id ?? null,
  };
}

function mapLatestClosedPunchToSummary(row) {
  return {
    isWorking: false,
    isOnBreak: false,
    attendanceClockIn: row.clock_in,
    attendanceClockOut: row.clock_out,
    linkedTechnicianJobId: null,
  };
}

function deriveLastAttendanceAt(att) {
  if (!att) return null;
  let maxTs = 0;
  if (att.attendanceClockIn) {
    const t = new Date(att.attendanceClockIn).getTime();
    if (!Number.isNaN(t)) maxTs = Math.max(maxTs, t);
  }
  if (att.attendanceClockOut) {
    const t = new Date(att.attendanceClockOut).getTime();
    if (!Number.isNaN(t)) maxTs = Math.max(maxTs, t);
  }
  return maxTs > 0 ? new Date(maxTs).toISOString() : null;
}

/** Portal last activity — users.updated_at is refreshed on login (session update). */
function derivePortalLastActive(user) {
  return user?.updated_at || null;
}

/** Slim list select for workers summary API (no nested detail blobs).
 *  users: id, username, status, role, is_logged_in, created_at, updated_at, deleted_at, current_session_id
 *  technicians: avatar_url, is_online, profile fields
 */
export const WORKER_LIST_SELECT = `
  id,
  username,
  role,
  status,
  is_logged_in,
  created_at,
  updated_at,
  technicians(
    id,
    full_name,
    email,
    phone_number,
    secondary_phone,
    avatar_url,
    street_address,
    state_province,
    zip_code,
    skills,
    nric_fin_work_permit_number,
    is_online,
    user_id,
    deleted_at
  )
`;

const TERMINAL_ASSIGNMENT_STATUS = new Set(["COMPLETED", "CANCELLED"]);

const EMPTY_PROFILE = {
  employment: {},
  access: {},
  payroll: {},
  schedule: cloneDefaultWorkerSchedule(),
  documents: [],
  other: {},
};

const SECTION_FETCHERS = {
  employment: (supabase, technicianId) =>
    supabase
      .from(TECHNICIAN_EMPLOYEE_TABLES.employment)
      .select("*")
      .eq("technician_id", technicianId)
      .is("deleted_at", null)
      .maybeSingle(),
  access: (supabase, technicianId) =>
    supabase
      .from(TECHNICIAN_EMPLOYEE_TABLES.access)
      .select("*")
      .eq("technician_id", technicianId)
      .is("deleted_at", null)
      .maybeSingle(),
  payroll: (supabase, technicianId) =>
    supabase
      .from(TECHNICIAN_EMPLOYEE_TABLES.payroll)
      .select("*")
      .eq("technician_id", technicianId)
      .is("deleted_at", null)
      .maybeSingle(),
  schedule: (supabase, technicianId) =>
    supabase
      .from(TECHNICIAN_EMPLOYEE_TABLES.schedules)
      .select("*")
      .eq("technician_id", technicianId)
      .is("deleted_at", null)
      .order("day_of_week", { ascending: true })
      .order("shift_number", { ascending: true }),
  documents: (supabase, technicianId) =>
    supabase
      .from(TECHNICIAN_EMPLOYEE_TABLES.documents)
      .select("*")
      .eq("technician_id", technicianId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  other: (supabase, technicianId) =>
    supabase
      .from(TECHNICIAN_EMPLOYEE_TABLES.other)
      .select("*")
      .eq("technician_id", technicianId)
      .is("deleted_at", null)
      .maybeSingle(),
};

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateWorkerCache(userId) {
  if (userId) {
    cache.delete(`core:${userId}`);
    return;
  }
  cache.clear();
}

function listTechniciansForUser(user) {
  const t = user?.technicians;
  if (!t) return [];
  const list = Array.isArray(t) ? t.filter(Boolean) : [t];
  return list.filter((tech) => !tech?.deleted_at);
}

function emptyAssignmentEntry() {
  return { hasActiveAssignment: false, assignmentStartedAt: null };
}

function isTerminalJobStatus(status) {
  if (status == null || status === "") return false;
  const s = String(status).toUpperCase();
  return (
    s === "COMPLETED" ||
    s === "CANCELLED" ||
    s.includes("COMPLET") ||
    s.includes("CANCEL")
  );
}

function mergeAssignmentActive(assignmentMap, technicianId, startedAt) {
  if (!technicianId) return;
  const prev = assignmentMap.get(technicianId) || emptyAssignmentEntry();
  prev.hasActiveAssignment = true;
  if (startedAt) {
    if (
      !prev.assignmentStartedAt ||
      new Date(startedAt) > new Date(prev.assignmentStartedAt)
    ) {
      prev.assignmentStartedAt = startedAt;
    }
  }
  assignmentMap.set(technicianId, prev);
}

function flatTechnicianIdsFromUserMap(userTechIdsMap) {
  const out = new Set();
  for (const set of userTechIdsMap.values()) {
    for (const id of set) out.add(id);
  }
  return [...out];
}

function formatDateForInput(dateValue) {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

async function fetchJobContactTypesByJobIdsChunked(supabase, jobIds) {
  const chunks = chunkIds(jobIds);
  return fetchChunkedInParallel(chunks, (batch) =>
    supabase.from("job_contact_type").select("*").in("job_id", batch)
  );
}

export async function buildUserToTechnicianIds(supabase, data) {
  const map = new Map();
  for (const user of data || []) {
    if (!user?.id) continue;
    const set = new Set();
    for (const t of listTechniciansForUser(user)) {
      if (t?.id) set.add(t.id);
    }
    map.set(user.id, set);
  }
  if (!supabase || map.size === 0) return map;

  const userIds = [...map.keys()];
  const CHUNK = 100;
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const batch = userIds.slice(i, i + CHUNK);
    const { data: rows, error } = await supabase
      .from("technicians")
      .select("id, user_id")
      .in("user_id", batch);

    if (error) {
      console.warn("buildUserToTechnicianIds:", error);
      continue;
    }
    for (const r of rows || []) {
      const set = map.get(r.user_id);
      if (set && r.id) set.add(r.id);
    }
  }
  return map;
}

export async function fetchTechnicianAssignmentSummary(supabase, technicianIds) {
  const assignmentMap = new Map();
  if (!supabase || !technicianIds?.length) return assignmentMap;
  const unique = [...new Set(technicianIds.filter(Boolean))];
  if (!unique.length) return assignmentMap;

  const CHUNK = 100;
  const rows = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("technician_jobs")
      .select("technician_id, assignment_status, job_id, started_at")
      .in("technician_id", batch)
      .is("deleted_at", null);

    if (error) {
      console.warn("fetchTechnicianAssignmentSummary technician_jobs:", error);
      continue;
    }
    if (data?.length) rows.push(...data);
  }

  const openAssignments = rows.filter((row) => {
    const ast = String(row.assignment_status || "").trim().toUpperCase();
    if (TERMINAL_ASSIGNMENT_STATUS.has(ast)) return false;
    return true;
  });

  const jobIds = [...new Set(openAssignments.map((r) => r.job_id).filter(Boolean))];
  const jobMeta = new Map();
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const batch = jobIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, deleted_at")
      .in("id", batch);
    if (error) {
      console.warn("fetchTechnicianAssignmentSummary jobs:", error);
      continue;
    }
    for (const j of data || []) {
      if (j?.id) jobMeta.set(j.id, j);
    }
  }

  for (const row of openAssignments) {
    const tid = row?.technician_id;
    if (!tid) continue;

    const jobId = row.job_id;
    if (!jobId) continue;

    const ast = String(row.assignment_status || "").trim().toUpperCase();
    const job = jobMeta.get(jobId);
    if (job) {
      if (job.deleted_at != null) continue;
      if (isTerminalJobStatus(job.status)) {
        const fieldContinues =
          ast === "STARTED" ||
          ast === "IN_PROGRESS" ||
          (row.started_at != null && row.started_at !== "");
        if (!fieldContinues) continue;
      }
    }

    mergeAssignmentActive(assignmentMap, tid, row.started_at || null);
  }

  return assignmentMap;
}

async function augmentTechnicianAssignmentFromPunches(supabase, attendanceMap, assignmentMap) {
  if (!supabase || !(attendanceMap instanceof Map)) return;
  const tjIds = new Set();
  for (const v of attendanceMap.values()) {
    if (v?.isWorking && v?.linkedTechnicianJobId) tjIds.add(v.linkedTechnicianJobId);
  }
  const unique = [...tjIds].filter(Boolean);
  if (!unique.length) return;

  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("technician_jobs")
      .select("id, technician_id, assignment_status, deleted_at, started_at")
      .in("id", batch)
      .is("deleted_at", null);

    if (error) {
      console.warn("augmentTechnicianAssignmentFromPunches:", error);
      continue;
    }
    for (const row of data || []) {
      const ast = String(row.assignment_status || "").trim().toUpperCase();
      if (TERMINAL_ASSIGNMENT_STATUS.has(ast)) continue;
      const tid = row?.technician_id;
      if (tid) mergeAssignmentActive(assignmentMap, tid, row.started_at || null);
    }
  }
}

export async function fetchAttendanceSummaryByTechnicianId(supabase, technicianIds) {
  const map = new Map();
  if (!supabase || !technicianIds?.length) return map;
  const unique = [...new Set(technicianIds.filter(Boolean))];
  if (!unique.length) return map;
  try {
    const { data: openRows, error: openError } = await supabase
      .from("attendance")
      .select(ATTENDANCE_SUMMARY_SELECT)
      .in("technician_id", unique)
      .is("clock_out", null);
    if (openError) {
      console.warn("fetchAttendanceSummaryByTechnicianId open punches:", openError);
      return map;
    }
    for (const row of openRows || []) {
      const tid = row?.technician_id;
      if (!tid) continue;
      const prev = map.get(tid);
      if (!prev || new Date(row.clock_in) > new Date(prev.attendanceClockIn)) {
        map.set(tid, mapOpenPunchToSummary(row));
      }
    }

    const { data: latestRows, error: latestError } = await fetchChunkedInParallel(
      chunkIds(unique),
      (batch) =>
        supabase
          .from("attendance")
          .select(ATTENDANCE_SUMMARY_SELECT)
          .in("technician_id", batch)
          .order("clock_in", { ascending: false })
          .limit(300)
    );
    if (latestError) {
      console.warn("fetchAttendanceSummaryByTechnicianId latest punches:", latestError);
      return map;
    }

    const latestByTech = new Map();
    for (const row of latestRows || []) {
      const tid = row?.technician_id;
      if (!tid || latestByTech.has(tid)) continue;
      latestByTech.set(tid, row);
    }

    for (const [tid, row] of latestByTech) {
      if (map.has(tid)) continue;
      map.set(tid, mapLatestClosedPunchToSummary(row));
    }

    return map;
  } catch (e) {
    console.warn("fetchAttendanceSummaryByTechnicianId:", e);
    return map;
  }
}

/** Single-technician attendance for view page (unified with list hook semantics). */
export async function fetchTechnicianAttendanceSummary(supabase, technicianId) {
  const empty = {
    isClockedIn: false,
    lastAttendanceAt: null,
  };
  if (!supabase || !technicianId) return empty;

  const map = await fetchAttendanceSummaryByTechnicianId(supabase, [technicianId]);
  const att = map.get(technicianId);
  if (!att) return empty;

  let maxTs = 0;
  if (att.attendanceClockIn) {
    const t = new Date(att.attendanceClockIn).getTime();
    if (!Number.isNaN(t)) maxTs = Math.max(maxTs, t);
  }
  if (att.attendanceClockOut) {
    const t = new Date(att.attendanceClockOut).getTime();
    if (!Number.isNaN(t)) maxTs = Math.max(maxTs, t);
  }

  return {
    isClockedIn: Boolean(att.isWorking),
    lastAttendanceAt: maxTs > 0 ? new Date(maxTs).toISOString() : null,
  };
}

export function mapUserToWorker(user, index, attendanceMap, assignmentMap, userTechIdsMap) {
  const techIdSet = user?.id ? userTechIdsMap.get(user.id) : null;
  const techIds =
    techIdSet && techIdSet.size > 0
      ? [...techIdSet]
      : listTechniciansForUser(user).map((t) => t.id).filter(Boolean);
  const technicians = listTechniciansForUser(user);
  const technician = technicians[0] || null;
  const primaryTechId = techIds[0] ?? null;
  const isOnline =
    Boolean(user?.is_logged_in) || technicians.some((t) => Boolean(t?.is_online));

  let att = null;
  for (const tid of techIds) {
    const row = attendanceMap.get(tid);
    if (row) {
      att = row;
      break;
    }
  }

  const hasTechnicianProfile = techIds.length > 0;
  const isWorking = att?.isWorking ?? false;
  const isClockedIn = isWorking;
  const isOnBreak = hasTechnicianProfile && isWorking && Boolean(att?.isOnBreak);
  const attendanceClockIn = att?.attendanceClockIn ?? null;
  const attendanceClockOut = att?.attendanceClockOut ?? null;

  let hasActiveJob = false;
  let assignmentStartedAt = null;
  for (const tid of techIds) {
    const entry = assignmentMap.get(tid);
    if (entry?.hasActiveAssignment) {
      hasActiveJob = true;
      if (entry.assignmentStartedAt) {
        if (
          !assignmentStartedAt ||
          new Date(entry.assignmentStartedAt) > new Date(assignmentStartedAt)
        ) {
          assignmentStartedAt = entry.assignmentStartedAt;
        }
      }
    }
  }

  if (!hasActiveJob && isWorking && att?.linkedTechnicianJobId) {
    hasActiveJob = true;
  }

  return {
    id: user.id,
    workerId: primaryTechId || user.id,
    hasTechnicianProfile,
    fullName: buildTechnicianDisplayName(technician, user),
    email: technician?.email || user.username || "",
    primaryPhone: technician?.phone_number || "",
    secondaryPhone: technician?.secondary_phone || "",
    role: user.role || "TECHNICIAN",
    status: user.status || "INACTIVE",
    activeUser: user.status === "ACTIVE",
    isOnline,
    isWorking,
    isClockedIn,
    attendanceClockIn,
    attendanceClockOut,
    showOnlineIndicator: isOnline || isClockedIn,
    isAdmin: user.role === "ADMIN",
    isFieldWorker: user.role === "TECHNICIAN",
    isActive: user.status === "ACTIVE",
    profilePicture: technician?.avatar_url || "/images/avatar/default-avatar.png",
    streetAddress: technician?.street_address || "",
    stateProvince: technician?.state_province || "",
    zipCode: technician?.zip_code || "",
    skills: technician?.skills || [],
    lastLogin: derivePortalLastActive(user),
    lastAttendanceAt: deriveLastAttendanceAt(att),
    isLoggedIn: Boolean(user.is_logged_in),
    nric_fin_work_permit_number: technician?.nric_fin_work_permit_number || "",
    index: index + 1,
    ...user,
    hasTechnicianProfile,
    hasActiveJob,
    isOnBreak,
    assignmentStartedAt,
  };
}

export async function transformUsersToWorkers(supabase, data) {
  const userTechIdsMap = await buildUserToTechnicianIds(supabase, data);
  const techIds = flatTechnicianIdsFromUserMap(userTechIdsMap);
  const [attendanceMap, assignmentMap] = await Promise.all([
    fetchAttendanceSummaryByTechnicianId(supabase, techIds),
    fetchTechnicianAssignmentSummary(supabase, techIds),
  ]);
  await augmentTechnicianAssignmentFromPunches(supabase, attendanceMap, assignmentMap);
  return (data || []).map((user, index) =>
    mapUserToWorker(user, index, attendanceMap, assignmentMap, userTechIdsMap)
  );
}

export async function fetchWorkerListStats(supabase) {
  const base = () => supabase.from("users").select("id", { count: "exact", head: true }).is("deleted_at", null);

  const [totalRes, activeRes, fieldRes] = await Promise.all([
    base(),
    base().eq("status", "ACTIVE"),
    base().eq("role", "TECHNICIAN"),
  ]);

  if (totalRes.error) throw totalRes.error;
  if (activeRes.error) throw activeRes.error;
  if (fieldRes.error) throw fieldRes.error;

  const totalUsers = totalRes.count ?? 0;
  const active = activeRes.count ?? 0;

  return {
    totalUsers,
    active,
    inactive: Math.max(0, totalUsers - active),
    fieldWorkers: fieldRes.count ?? 0,
  };
}

export async function fetchWorkersListSummary(supabase, { page = 1, limit = 25, search = "" } = {}) {
  if (!supabase) throw new Error("No Supabase client");

  const tokens = parseSearchTokens(search);
  const { data, totalCount } = await paginatedSelect(supabase, "users", WORKER_LIST_SELECT, {
    page,
    limit,
    order: { column: "created_at", ascending: false },
    filters: (query) => {
      if (tokens.length === 0) return query;
      return applyMultiTokenIlikeFilters(query, tokens, ["username", "role", "status"]);
    },
  });

  const workers = await transformUsersToWorkers(supabase, data || []);
  return { workers, totalCount };
}

/** Slim select for job-assignment dropdowns (technicians-first, ACTIVE field workers only). */
const ASSIGNABLE_TECHNICIAN_SELECT = `
  id,
  user_id,
  full_name,
  first_name,
  middle_name,
  last_name,
  user:users!inner (
    id,
    username,
    role,
    status,
    deleted_at
  )
`;

/**
 * Active TECHNICIAN roster for assignment dropdowns — ordered by full_name, searchable by name.
 */
export async function fetchAssignableTechnicians(
  supabase,
  { page = 1, limit = 200, search = "" } = {}
) {
  if (!supabase) throw new Error("No Supabase client");

  const tokens = parseSearchTokens(search);
  const cappedLimit = Math.min(Math.max(1, Number(limit) || 200), 200);

  const { data, totalCount } = await paginatedSelect(
    supabase,
    "technicians",
    ASSIGNABLE_TECHNICIAN_SELECT,
    {
      page,
      limit: cappedLimit,
      order: { column: "full_name", ascending: true },
      filters: (query) => {
        let q = query
          .eq("user.role", "TECHNICIAN")
          .eq("user.status", "ACTIVE")
          .is("user.deleted_at", null);
        if (tokens.length === 0) return q;
        return applyMultiTokenIlikeFilters(q, tokens, [
          "full_name",
          "first_name",
          "middle_name",
          "last_name",
        ]);
      },
    }
  );

  const workers = (data || []).map((row) => {
    const user = row.user;
    return {
      id: user?.id || row.user_id,
      fullName: buildTechnicianDisplayName(row, user),
      username: user?.username || "",
      technicianId: row.id,
    };
  });

  return { workers, totalCount };
}

function mapPersonalData(userData, technician) {
  return {
    profilePicture: technician?.avatar_url || "/images/avatar/NoProfile.png",
    firstName: technician?.first_name || "",
    middleName: technician?.middle_name || "",
    lastName: technician?.last_name || "",
    fullName: technician?.full_name || userData?.username || "",
    gender: technician?.gender?.toLowerCase() || "",
    dateOfBirth: formatDateForInput(technician?.date_of_birth),
    email: userData?.username || technician?.email || "",
    workerId: technician?.id || userData?.id || "",
    password: "",
    shortBio: technician?.bio || "",
    activeUser: userData?.status === "ACTIVE",
    isAdmin: userData?.role === "ADMIN",
    isFieldWorker: userData?.role === "TECHNICIAN",
    role: userData?.role || "TECHNICIAN",
    nricFinWorkPermitNumber: technician?.nric_fin_work_permit_number || "",
    workPermitExpiryDate: formatDateForInput(technician?.work_permit_expiry_date),
    jobIncentiveHourlyRate: Number(technician?.job_incentive_hourly_rate || 0),
    sapTechCode: technician?.sap_tech_code || "",
  };
}

function mapContactData(userData, technician) {
  return {
    primaryPhone: technician?.phone_number || technician?.primary_phone || "",
    secondaryPhone: technician?.secondary_phone || "",
    activePhone1: technician?.active_phone_1 || false,
    activePhone2: technician?.active_phone_2 || false,
    email: userData?.username || technician?.email || "",
    address: {
      stateProvince: technician?.state_province || "",
      streetAddress: technician?.street_address || "",
      postalCode: technician?.zip_code || technician?.postal_code || "",
      city: technician?.city || "",
      country: technician?.country || "",
    },
    emergencyContactName: technician?.emergency_contact_name || "",
    emergencyContactPhone: technician?.emergency_contact_phone || "",
    emergencyRelationship: technician?.emergency_relationship || "",
  };
}

export function mapCoreToViewTechnician({ userData, technician, technicianId, hasTechnicianRecord }) {
  if (technician && hasTechnicianRecord) {
    return {
      ...technician,
      id: technician.id,
      workerId: technician.user_id || userData?.id,
      technicianId: technician.id,
      fullName: buildTechnicianDisplayName(technician, technician.user || userData),
      firstName: technician.first_name || "",
      middleName: technician.middle_name || "",
      lastName: technician.last_name || "",
      email: technician.email || technician.user?.email || userData?.username || "",
      phoneNumber: technician.phone_number || technician.primary_phone || "",
      primaryPhone: technician.primary_phone || technician.phone_number || "",
      secondaryPhone: technician.secondary_phone || "",
      dateOfBirth: technician.date_of_birth || null,
      gender: technician.gender || null,
      streetAddress: technician.street_address || "",
      stateProvince: technician.state_province || "",
      zipCode: technician.zip_code || "",
      city: technician.city || "",
      country: technician.country || "",
      profilePicture:
        technician.avatar_url ||
        technician.profile_picture ||
        "/images/avatar/NoProfile.png",
      bio: technician.bio || "",
      nricFinWorkPermitNumber: technician.nric_fin_work_permit_number || "",
      workPermitExpiryDate: technician.work_permit_expiry_date || null,
      status: technician.user?.status || technician.status || userData?.status || "INACTIVE",
      isActive: (technician.user?.status || technician.status || userData?.status) === "ACTIVE",
      isOnline: Boolean(technician.is_online) || Boolean(userData?.is_logged_in || technician.user?.is_logged_in),
      role: technician.user?.role || userData?.role || "TECHNICIAN",
      skills: technician.skills || [],
      certificates: technician.certificates || [],
      documents: technician.documents || [],
      emergencyContactName: technician.emergency_contact_name || "",
      emergencyContactPhone: technician.emergency_contact_phone || "",
      emergencyRelationship: technician.emergency_relationship || "",
      jobIncentiveHourlyRate: Number(technician.job_incentive_hourly_rate || 0),
      job_incentive_hourly_rate: Number(technician.job_incentive_hourly_rate || 0),
      hasTechnicianRecord: true,
      lastLogin: derivePortalLastActive(userData || technician.user),
    };
  }

  return {
    ...userData,
    id: userData?.id,
    workerId: userData?.id,
    technicianId: technicianId || userData?.id,
    fullName: buildTechnicianDisplayName(null, userData),
    firstName: "",
    middleName: "",
    lastName: "",
    email: userData?.email || userData?.username || "",
    phoneNumber: "",
    primaryPhone: "",
    secondaryPhone: "",
    dateOfBirth: null,
    gender: null,
    streetAddress: "",
    stateProvince: "",
    zipCode: "",
    city: "",
    country: "",
    profilePicture: "/images/avatar/NoProfile.png",
    bio: "",
    nricFinWorkPermitNumber: "",
    workPermitExpiryDate: null,
    status: userData?.status || "INACTIVE",
    isActive: userData?.status === "ACTIVE",
    isOnline: false,
    role: userData?.role || "TECHNICIAN",
    skills: technician?.skills || [],
    certificates: [],
    documents: [],
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyRelationship: "",
    jobIncentiveHourlyRate: 0,
    job_incentive_hourly_rate: 0,
    hasTechnicianRecord: Boolean(hasTechnicianRecord && technicianId),
    lastLogin: derivePortalLastActive(userData),
  };
}

export async function fetchWorkerCoreByUserId(supabase, userId) {
  if (!supabase || !userId) {
    return {
      userId: userId || null,
      technicianId: null,
      hasTechnicianRecord: false,
      userData: null,
      technician: null,
      personalData: {},
      contactData: {},
      viewTechnician: null,
    };
  }

  const cacheKey = `core:${userId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let technician = null;
  let userData = null;

  try {
    const result = await supabase
      .from("technicians")
      .select(
        `
        *,
        user:users!technicians_user_id_fkey(id, username, role, status, is_logged_in, updated_at)
      `
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (result.error) {
      console.warn("fetchWorkerCoreByUserId technician query:", result.error);
    } else if (result.data && !result.data.deleted_at) {
      technician = result.data;
      userData = result.data.user || null;
    }
  } catch (err) {
    console.warn("fetchWorkerCoreByUserId technician lookup:", err);
  }

  if (!userData) {
    const result = await supabase
      .from("users")
      .select("*, technicians(*)")
      .eq("id", userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (result.error) {
      console.warn("fetchWorkerCoreByUserId user query:", result.error);
    } else if (result.data) {
      userData = result.data;
      if (!technician) {
        const nested = listTechniciansForUser(result.data)[0];
        if (nested && !nested.deleted_at) {
          technician = nested;
        }
      }
    }
  }

  if (!technician && userData) {
    try {
      const lookup = await supabase
        .from("technicians")
        .select("id, skills, user_id")
        .eq("user_id", userData.id)
        .maybeSingle();
      if (lookup.data && !lookup.data.deleted_at) {
        technician = { ...lookup.data, user: userData };
      }
    } catch (err) {
      console.warn("fetchWorkerCoreByUserId technician skills lookup:", err);
    }
  }

  const technicianId = technician?.id || null;
  const hasTechnicianRecord = Boolean(technicianId);
  const techForMapping = technician?.user ? technician : technician;

  const core = {
    userId,
    technicianId,
    hasTechnicianRecord,
    userData,
    technician: techForMapping,
    personalData: mapPersonalData(userData, technician),
    contactData: mapContactData(userData, technician),
    viewTechnician: mapCoreToViewTechnician({
      userData,
      technician: techForMapping,
      technicianId,
      hasTechnicianRecord,
    }),
  };

  setCache(cacheKey, core);
  return core;
}

export async function fetchWorkerEmployeeSections(supabase, technicianId, { sections } = {}) {
  if (!supabase || !technicianId) return { ...EMPTY_PROFILE };

  if (!sections || !sections.length) {
    return fetchTechnicianEmployeeProfile(supabase, technicianId);
  }

  const requested = [...new Set(sections.filter((s) => SECTION_FETCHERS[s]))];
  if (!requested.length) {
    return { ...EMPTY_PROFILE };
  }

  const ignoredMissingTableCodes = new Set(["42P01", "PGRST205"]);
  const entries = await Promise.all(
    requested.map(async (key) => {
      const response = await SECTION_FETCHERS[key](supabase, technicianId);
      return [key, response];
    })
  );

  const unexpectedError = entries.find(
    ([, response]) =>
      response?.error && !ignoredMissingTableCodes.has(response.error.code)
  )?.[1]?.error;

  if (unexpectedError) throw unexpectedError;

  const profile = { ...EMPTY_PROFILE };
  for (const [key, response] of entries) {
    if (key === "schedule") {
      profile.schedule = normalizeScheduleRows(response.data || []);
    } else if (key === "documents") {
      profile.documents = response.data || [];
    } else {
      profile[key] = response.data || {};
    }
  }
  return profile;
}

export function buildAssignmentFromTechnicianJob(tj, { jobIncentiveHourlyRate = 0 } = {}) {
  const job = tj.job;
  if (!job || job.deleted_at) return null;

  const rate = Number(
    jobIncentiveHourlyRate ??
      tj.technician?.job_incentive_hourly_rate ??
      0
  );
  const incentive = calculateTechnicianJobIncentive({
    ...tj,
    technician: {
      job_incentive_hourly_rate: rate,
    },
  });
  const cachedHours = (() => {
    const th = Array.isArray(tj.technician_hours) ? tj.technician_hours[0] : tj.technician_hours;
    const h = Number(th?.labor_hours);
    return Number.isFinite(h) ? h : null;
  })();
  const laborHours = cachedHours != null ? cachedHours : incentive.laborHours;
  const incentiveAmount =
    cachedHours != null
      ? Math.round(cachedHours * incentive.incentiveRate * 100) / 100
      : incentive.incentiveAmount;
  const periodAnchorMs = assignmentPeriodAnchorMs({
    started_at: tj.started_at,
    completed_at: tj.completed_at,
    assignment_status: tj.assignment_status,
    job: {
      scheduled_start: job.scheduled_start,
      scheduled_end: job.scheduled_end,
      status: job.status,
    },
  });

  return {
    ...job,
    id: job.id,
    assignmentId: tj.id,
    jobNo: job.job_number,
    jobName: job.title,
    jobDescription: job.description,
    customerName: job.customer?.customer_name || "",
    customerID: job.customer_id,
    jobStatus: job.status,
    priority: job.priority,
    startDate: job.scheduled_start ? new Date(job.scheduled_start).toISOString().split("T")[0] : "",
    endDate: job.scheduled_end ? new Date(job.scheduled_end).toISOString().split("T")[0] : "",
    startTime: job.job_schedule?.[0]?.jstime || "",
    endTime: job.job_schedule?.[0]?.jetime || "",
    jobContactType: job.job_contact_type?.[0] || null,
    assignmentStatus: tj.assignment_status,
    startedAt: tj.started_at,
    completedAt: tj.completed_at,
    laborHours,
    incentiveRate: incentive.incentiveRate,
    incentiveAmount,
    periodAnchorMs,
  };
}

export async function fetchTechnicianAssignments(supabase, technicianId, { year, month } = {}) {
  if (!supabase || !technicianId) return [];

  const tz = getFsmLaborPeriodTimezone();
  const now = new Date();
  const y = year ?? now.getFullYear();
  const m = month ?? now.getMonth() + 1;
  const { startMs, endMs } = getFsmPeriodRangeMs("M", y, m, 1, tz);

  const { data: laborRows, error } = await fetchTechnicianJobsLaborInPeriod(
    supabase,
    startMs,
    endMs,
    { technicianId, detailed: true }
  );
  if (error) throw error;
  if (!laborRows?.length) return [];

  const jobIds = [
    ...new Set(laborRows.map((row) => row.job_id || row.job?.id).filter(Boolean)),
  ];

  const [contactResult, scheduleResult] = await Promise.all([
    fetchJobContactTypesByJobIdsChunked(supabase, jobIds),
    fetchJobSchedulesByJobIdsChunked(supabase, jobIds),
  ]);

  if (contactResult.error) throw contactResult.error;
  if (scheduleResult.error) throw scheduleResult.error;

  const contactTypeMap = {};
  for (const ct of contactResult.data || []) {
    if (!contactTypeMap[ct.job_id]) contactTypeMap[ct.job_id] = [];
    contactTypeMap[ct.job_id].push(ct);
  }

  const scheduleMap = {};
  for (const schedule of scheduleResult.data || []) {
    if (!scheduleMap[schedule.job_id]) scheduleMap[schedule.job_id] = [];
    scheduleMap[schedule.job_id].push(schedule);
  }

  const enriched = laborRows.map((row) => {
    const jobId = row.job_id || row.job?.id;
    return {
      ...row,
      job: row.job
        ? {
            ...row.job,
            id: row.job.id || jobId,
            job_contact_type: contactTypeMap[jobId] || [],
            job_schedule: scheduleMap[jobId] || [],
          }
        : row.job,
    };
  });

  const uniqueJobs = dedupeTechnicianJobRows(enriched, "job_id");
  const rate =
    enriched[0]?.technician?.job_incentive_hourly_rate ??
    laborRows[0]?.technician?.job_incentive_hourly_rate ??
    0;

  return uniqueJobs
    .map((tj) => buildAssignmentFromTechnicianJob(tj, { jobIncentiveHourlyRate: rate }))
    .filter(Boolean);
}

import { jobDisplayCustomerName } from '../utils/embeddedCustomerName';

/** Slim select for follow-up list / quick-summary APIs (no job(*), no technician_jobs(*)). */
export const SUPABASE_FOLLOWUP_LIST_SELECT = `
  id,
  job_id,
  user_id,
  technician_id,
  status_updated_by,
  status_updated_by_account,
  type,
  status,
  priority,
  notes,
  due_date,
  created_at,
  updated_at,
  job:jobs!inner(
    id,
    job_number,
    title,
    description,
    customer_id,
    customer:customer_id(id, customer_name, customer_code)
  ),
  user:user_id(id, username),
  technician:technician_id(id, full_name, email, status)
`;

/** Active / open-like statuses (includes legacy keys still present in DB). */
export const OPEN_FOLLOWUP_STATUSES = [
  'OPEN',
  'QUOTATION_IN_PROGRESS',
  'QUOTATION_SENT',
  'LOGGED',
  'IN_PROGRESS',
  'PENDING',
];

export const FOLLOWUP_OPEN_STATUS_OR = OPEN_FOLLOWUP_STATUSES.flatMap((s) => {
  const spaced = s.replace(/_/g, ' ');
  const variants = spaced === s ? [s] : [s, spaced];
  return variants.map((v) => `status.ilike.${v}`);
}).join(',');

export function normalizeFollowUpStatusForDB(status) {
  if (!status || status === 'all') return status;

  const normalized = String(status).trim();
  const statusMap = {
    'in progress': 'IN_PROGRESS',
    'in_progress': 'IN_PROGRESS',
    'quotation in progress': 'QUOTATION_IN_PROGRESS',
    quotation_in_progress: 'QUOTATION_IN_PROGRESS',
    'quotation sent': 'QUOTATION_SENT',
    quotation_sent: 'QUOTATION_SENT',
    logged: 'LOGGED',
    closed: 'CLOSED',
    cancelled: 'CANCELLED',
    canceled: 'CANCELLED',
    open: 'OPEN',
    pending: 'PENDING',
    completed: 'COMPLETED',
  };

  const lowerStatus = normalized.toLowerCase().replace(/_/g, ' ');
  if (statusMap[lowerStatus]) return statusMap[lowerStatus];
  return normalized.toUpperCase().replace(/\s+/g, '_');
}

/**
 * Canonical UI labels for follow-up statuses.
 * Maps legacy case variants (OPEN, COMPLETED) to Title Case without changing DB rows.
 */
export function canonicalizeFollowUpStatusLabel(status) {
  if (status == null || status === '') return status;

  const key = String(status).trim().toLowerCase().replace(/_/g, ' ');
  const labelMap = {
    'quotation in progress': 'Quotation In Progress',
    'quotation sent': 'Quotation Sent',
    open: 'Open',
    cancelled: 'Cancelled',
    canceled: 'Cancelled',
    completed: 'Completed',
    closed: 'Closed',
    logged: 'Logged',
    pending: 'Pending',
    'in progress': 'In Progress',
  };

  return labelMap[key] || String(status).trim().replace(/_/g, ' ');
}

/** Preferred dropdown / filter order for follow-up statuses. */
export const DEFAULT_FOLLOW_UP_STATUS_OPTIONS = [
  'Quotation In Progress',
  'Quotation Sent',
  'Open',
  'Completed',
  'Cancelled',
];

const FOLLOW_UP_STATUS_ORDER = DEFAULT_FOLLOW_UP_STATUS_OPTIONS.map((s) =>
  s.toLowerCase()
);

/**
 * Deduplicate status option lists (Open/OPEN → Open) and ensure Completed is present.
 * Replaces a redundant OPEN-only entry with Completed when Open is already present.
 */
export function normalizeFollowUpStatusOptions(statuses) {
  const source =
    Array.isArray(statuses) && statuses.length > 0
      ? statuses
      : DEFAULT_FOLLOW_UP_STATUS_OPTIONS;

  const seen = new Set();
  const result = [];

  for (const raw of source) {
    const name =
      typeof raw === 'string'
        ? raw
        : raw?.name != null
          ? String(raw.name)
          : '';
    if (!name.trim()) continue;

    const canonical = canonicalizeFollowUpStatusLabel(name);
    const key = String(canonical).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }

  if (!seen.has('completed')) {
    const cancelledIdx = result.findIndex(
      (s) => String(s).toLowerCase() === 'cancelled'
    );
    if (cancelledIdx >= 0) {
      result.splice(cancelledIdx, 0, 'Completed');
    } else {
      result.push('Completed');
    }
    seen.add('completed');
  }

  return result.slice().sort((a, b) => {
    const ai = FOLLOW_UP_STATUS_ORDER.indexOf(String(a).toLowerCase());
    const bi = FOLLOW_UP_STATUS_ORDER.indexOf(String(b).toLowerCase());
    if (ai === -1 && bi === -1) return String(a).localeCompare(String(b));
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export function isKnownFollowUpStatusOption(status, options = DEFAULT_FOLLOW_UP_STATUS_OPTIONS) {
  if (!status) return false;
  const canonical = canonicalizeFollowUpStatusLabel(status);
  return options.some(
    (opt) => String(opt).toLowerCase() === String(canonical).toLowerCase()
  );
}

/** @type {Record<1 | 2 | 3 | 4, 'Low' | 'Normal' | 'High' | 'Urgent'>} */
export const FOLLOW_UP_PRIORITY_LABELS = {
  1: 'Low',
  2: 'Normal',
  3: 'High',
  4: 'Urgent',
};

export function normalizeFollowUpPriorityForFilter(priority) {
  if (!priority || priority === 'all') return null;

  const raw = String(priority).trim();
  const numericKey = Number(raw);
  if (Number.isFinite(numericKey) && FOLLOW_UP_PRIORITY_LABELS[numericKey]) {
    return FOLLOW_UP_PRIORITY_LABELS[numericKey];
  }

  const labelMatch = Object.values(FOLLOW_UP_PRIORITY_LABELS).find(
    (label) => label.toLowerCase() === raw.toLowerCase()
  );
  return labelMatch || raw;
}

/**
 * PostgREST .or() clause matching priority stored as label ("Normal") or numeric string ("2").
 */
export function buildFollowUpPriorityFilterOr(priority) {
  const label = normalizeFollowUpPriorityForFilter(priority);
  if (!label) return null;

  const numericKey = Object.entries(FOLLOW_UP_PRIORITY_LABELS).find(
    ([, value]) => value.toLowerCase() === label.toLowerCase()
  )?.[0];

  const parts = [`priority.ilike.${label}`];
  if (numericKey) {
    parts.push(`priority.eq.${numericKey}`);
  }
  return parts.join(',');
}

/**
 * PostgREST .or() clause matching status stored as display text ("Open") or DB keys ("OPEN").
 * Includes Title Case + SCREAMING_SNAKE so legacy rows remain filterable.
 */
export function buildFollowUpStatusFilterOr(status) {
  if (!status || status === 'all') return null;

  const display = String(status).trim();
  const canonical = canonicalizeFollowUpStatusLabel(display);
  const dbKey = normalizeFollowUpStatusForDB(status);
  const spacedKey = dbKey.replace(/_/g, ' ');
  const variants = [...new Set([display, canonical, dbKey, spacedKey].filter(Boolean))];

  return variants.map((value) => `status.ilike.${value}`).join(',');
}

/** Inner join fragment for count/head queries (excludes follow-ups on deleted jobs). */
const followUpActiveJobInnerSelect = 'job:jobs!inner(deleted_at)';

/** Select string for follow-up count/head queries (requires applyActiveFollowUpJobFilter). */
export function buildFollowUpCountHeadSelect() {
  return `id, ${followUpActiveJobInnerSelect}`;
}

/** Exclude follow-ups whose parent job was soft-deleted (requires jobs!inner in select). */
export function applyActiveFollowUpJobFilter(query) {
  return query.is('job.deleted_at', null);
}

/** Active follow-ups only: not soft-deleted and parent job still active. */
export function applyActiveFollowUpScope(query) {
  return applyActiveFollowUpJobFilter(query.is('deleted_at', null));
}

/** Soft-delete all active follow-ups for the given job IDs (job delete cascade). */
export async function softDeleteFollowUpsForJobs(supabase, jobIds, deletedAt) {
  const uniqueIds = [...new Set((jobIds || []).filter(Boolean))];
  if (!uniqueIds.length || !supabase) return;

  const ts = deletedAt || new Date().toISOString();
  const { error } = await supabase
    .from('followups')
    .update({ deleted_at: ts })
    .in('job_id', uniqueIds)
    .is('deleted_at', null);

  if (error) throw error;
}

/** Apply status / type / priority filters to a followups query builder. */
export function applyFollowUpListFilters(query, { status, type, priority } = {}) {
  let q = query;

  const statusOr = buildFollowUpStatusFilterOr(status);
  if (statusOr) {
    q = q.or(statusOr);
  }

  if (type && type !== 'all') {
    q = q.ilike('type', type);
  }

  const priorityOr = buildFollowUpPriorityFilterOr(priority);
  if (priorityOr) {
    q = q.or(priorityOr);
  }

  return q;
}

function getFollowUpCSOName(followUp, user) {
  return (
    followUp?.status_updated_by_account ||
    user?.full_name ||
    user?.username ||
    '-'
  );
}

function dedupeTechnicians(assignedTechnicians) {
  const unique = [];
  const seenIds = new Set();
  const seenNames = new Set();

  for (const tech of assignedTechnicians) {
    const techId = tech.technicianId || tech.technician?.id;
    const techName = tech.technicianName || tech.full_name;

    if (techId && !seenIds.has(techId)) {
      seenIds.add(techId);
      unique.push(tech);
    } else if (!techId && techName && !seenNames.has(techName)) {
      seenNames.add(techName);
      unique.push(tech);
    }
  }

  return unique;
}

export function buildAssignedTechnicians(
  followUp,
  technicianJobsByJobId = {},
  technicianMap = {}
) {
  const job = followUp.job || {};
  const technician = followUp.technician || {};
  let assignedTechnicians = [];

  const jobTechs = technicianJobsByJobId[job.id];
  if (Array.isArray(jobTechs) && jobTechs.length > 0) {
    assignedTechnicians = jobTechs.map((tech) => ({
      technicianId: tech.id,
      technicianName: tech.full_name || 'Unknown Technician',
      full_name: tech.full_name || 'Unknown Technician',
      technician: tech,
    }));
  }

  const existingTechIds = new Set(
    assignedTechnicians.map((t) => t.technicianId).filter(Boolean)
  );

  if (followUp.technician_id && !existingTechIds.has(followUp.technician_id)) {
    if (technician?.full_name && technician.id) {
      assignedTechnicians.push({
        technicianId: technician.id || followUp.technician_id,
        technicianName: technician.full_name,
        full_name: technician.full_name,
        technician,
      });
    } else if (technicianMap[followUp.technician_id]) {
      const tech = technicianMap[followUp.technician_id];
      assignedTechnicians.push({
        technicianId: tech.id || followUp.technician_id,
        technicianName: tech.full_name,
        full_name: tech.full_name,
        technician: tech,
      });
    }
  }

  return dedupeTechnicians(assignedTechnicians);
}

/**
 * Map a slim Supabase follow-up row to the follow-ups page / QuickMenu shape.
 */
export function formatFollowUpListRow(
  followUp,
  { technicianJobsByJobId = {}, jobFollowUpCount = 1 } = {}
) {
  const job = followUp.job || {};
  const user = followUp.user || {};
  const assignedTechnicians = buildAssignedTechnicians(followUp, technicianJobsByJobId);
  const technicianNames = assignedTechnicians
    .map((t) => t.technicianName || t.full_name)
    .filter(Boolean);

  return {
    id: followUp.id,
    jobID: job.id,
    jobNumber: job.job_number || job.id,
    jobName: job.title || '',
    customerName: jobDisplayCustomerName(job),
    customerID: job.customer_id,
    priority: followUp.priority ?? 2,
    status: followUp.status,
    type: followUp.type,
    assignedTechnicians,
    technicianName: technicianNames.length > 0 ? technicianNames.join(', ') : '-',
    technicianId: followUp.technician_id,
    csoName: getFollowUpCSOName(followUp, user),
    createdAt: followUp.created_at,
    updatedAt: followUp.updated_at,
    dueDate: followUp.due_date,
    notes: followUp.notes,
    assignedWorkers: followUp.technician_id
      ? [
          {
            workerId: followUp.technician_id,
            workerName:
              technicianNames.length > 0
                ? technicianNames.join(', ')
                : followUp.technician?.full_name || '-',
          },
        ]
      : [],
    jobFollowUpCount,
  };
}

/** Batch-fetch technician_jobs for visible page job IDs (kept out of main select). */
export async function fetchTechniciansByJobIds(supabase, jobIds) {
  const map = {};
  if (!jobIds?.length) return map;

  const uniqueIds = [...new Set(jobIds.filter(Boolean))];
  const chunkSize = 100;

  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const batch = uniqueIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('technician_jobs')
      .select(
        `
        job_id,
        technician_id,
        technician:technician_id(id, full_name, email)
      `
      )
      .in('job_id', batch)
      .is('deleted_at', null);

    if (error) {
      console.warn('technician_jobs batch fetch:', error.message);
      continue;
    }

    for (const row of data || []) {
      if (!row.job_id || !row.technician) continue;
      if (!map[row.job_id]) map[row.job_id] = [];
      map[row.job_id].push(row.technician);
    }
  }

  return map;
}

export function computeJobFollowUpCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const jobKey = row.job_id || row.job?.id;
    if (!jobKey) continue;
    counts[jobKey] = (counts[jobKey] || 0) + 1;
  }
  return counts;
}

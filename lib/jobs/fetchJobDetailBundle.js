import { getServiceAddressFromAifmJobDescription } from '../integrations/aifmJobLocationFromApi';
import { jobService, followUpService } from '../supabase/database';
import { resolveJobDisplayAddress } from './resolveJobDisplayAddress';
import { isJobRouteIdUuid } from './jobDetailHelpers';

const ATTENDANCE_SELECT = `
  id,
  clock_in,
  clock_out,
  duration_minutes,
  notes,
  technician_job_id,
  technician_id,
  technician:technician_id(full_name)
`;

async function fetchAttendanceRows(supabase, activeTechnicianJobs) {
  const tjIds = activeTechnicianJobs.map((tj) => tj.id).filter(Boolean);
  const techIds = [
    ...new Set(activeTechnicianJobs.map((tj) => tj.technician_id).filter(Boolean)),
  ];

  if (tjIds.length === 0 && techIds.length === 0) {
    return [];
  }

  let attQuery = supabase
    .from('attendance')
    .select(ATTENDANCE_SELECT)
    .order('clock_in', { ascending: false });

  if (tjIds.length > 0 && techIds.length > 0) {
    attQuery = attQuery.or(
      `technician_job_id.in.(${tjIds.join(',')}),and(technician_id.in.(${techIds.join(',')}),technician_job_id.is.null)`
    );
  } else if (tjIds.length > 0) {
    attQuery = attQuery.in('technician_job_id', tjIds);
  } else {
    attQuery = attQuery.in('technician_id', techIds).is('technician_job_id', null);
  }

  const { data, error } = await attQuery;
  if (error) {
    console.warn('[fetchJobDetailBundle] attendance:', error.message);
    return [];
  }
  return data || [];
}

async function maybeResolveAifmScheduleAddress(supabase, jobData, jobSchedule, customerLocations) {
  const hasScheduleAddress = Boolean(jobSchedule?.address && String(jobSchedule.address).trim());
  const hasCustomerLocation = Boolean(customerLocations?.length);
  const hasLocationName = Boolean(
    jobData.location?.location_name || jobData.location?.locationName
  );
  const hasAifmTag = /\[AIFM:[^\]]+\]/.test(jobData.description || '');

  if (hasScheduleAddress || hasCustomerLocation || hasLocationName || !hasAifmTag) {
    return null;
  }

  const resolved = resolveJobDisplayAddress(jobData, {
    scheduleAddress: null,
    customerLocations: customerLocations || [],
  });
  if (resolved) {
    return resolved;
  }

  try {
    return await getServiceAddressFromAifmJobDescription(
      jobData.description,
      jobData.scheduled_start
    );
  } catch (err) {
    console.warn('[fetchJobDetailBundle] AIFM address lookup failed:', err?.message);
    return null;
  }
}

/**
 * Server-side batched fetch for job detail page (single job graph + related rows).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} jobId UUID or job_number from route
 */
export async function fetchJobDetailBundle(supabase, jobId) {
  const jobData = isJobRouteIdUuid(jobId)
    ? await jobService.findById(jobId, supabase)
    : await jobService.findByJobNumber(jobId, supabase);

  if (!jobData) {
    return null;
  }

  const jobUuid = jobData.id;
  const customerId = jobData.customer_id;
  const activeTechnicianJobs = (jobData.technician_jobs || []).filter((tj) => tj.deleted_at == null);
  const technicianIds = [
    ...new Set(activeTechnicianJobs.map((tj) => tj.technician_id).filter(Boolean)),
  ];
  const taskIds = (jobData.job_tasks || []).map((t) => t.id).filter(Boolean);
  const actorUserIds = new Set();

  const [
    jobScheduleResult,
    customerLocationsResult,
    contactsResult,
    followUps,
    paymentProfilesResult,
    taskCompletionsResult,
    workersResult,
    locationTechniciansResult,
    attendanceRows,
  ] = await Promise.all([
    supabase.from('job_schedule').select('*').eq('job_id', jobUuid).maybeSingle(),
    customerId
      ? supabase
          .from('customer_location')
          .select('*')
          .eq('customer_id', customerId)
          .order('site_id', { ascending: true })
      : Promise.resolve({ data: [] }),
    customerId
      ? supabase.from('contacts').select('*').eq('customer_id', customerId)
      : Promise.resolve({ data: [] }),
    followUpService.getByJobId(jobUuid, supabase),
    supabase
      .from('payment_profiles')
      .select('*')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true }),
    taskIds.length > 0
      ? supabase.from('task_completions').select('*').in('job_task_id', taskIds)
      : Promise.resolve({ data: [] }),
    technicianIds.length > 0
      ? supabase
          .from('technicians')
          .select('*, users(*)')
          .in('id', technicianIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] }),
    technicianIds.length > 0
      ? supabase
          .from('location_technicians')
          .select('*')
          .in('technician_id', technicianIds)
          .order('tracked_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    fetchAttendanceRows(supabase, activeTechnicianJobs),
  ]);

  for (const fu of followUps || []) {
    if (fu.user_id) actorUserIds.add(fu.user_id);
    if (fu.status_updated_by) actorUserIds.add(fu.status_updated_by);
  }

  let actorUsers = [];
  let actorTechnicians = [];
  const actorIds = [...actorUserIds];

  if (actorIds.length > 0) {
    const [usersRes, techRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, username, role')
        .in('id', actorIds)
        .is('deleted_at', null),
      supabase
        .from('technicians')
        .select('user_id, full_name, email')
        .in('user_id', actorIds)
        .is('deleted_at', null),
    ]);
    actorUsers = usersRes.data || [];
    actorTechnicians = techRes.data || [];
  }

  let createdByUser = null;
  let createdByTechnician = null;
  if (jobData.created_by) {
    const [userRes, techRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, username')
        .eq('id', jobData.created_by)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('technicians')
        .select('user_id, full_name, email')
        .eq('user_id', jobData.created_by)
        .is('deleted_at', null)
        .maybeSingle(),
    ]);
    createdByUser = userRes.data;
    createdByTechnician = techRes.data;
  }

  const customerLocations = customerLocationsResult.data || [];
  const resolvedScheduleAddress = await maybeResolveAifmScheduleAddress(
    supabase,
    jobData,
    jobScheduleResult.data,
    customerLocations
  );

  return {
    jobData,
    jobSchedule: jobScheduleResult.data,
    customerLocations,
    contacts: contactsResult.data || [],
    followUps: followUps || [],
    taskCompletions: taskCompletionsResult.data || [],
    actorUsers,
    actorTechnicians,
    createdByUser,
    createdByTechnician,
    workers: workersResult.data || [],
    locationTechnicians: locationTechniciansResult.data || [],
    attendance: attendanceRows,
    paymentProfiles: paymentProfilesResult.data || [],
    resolvedScheduleAddress,
  };
}

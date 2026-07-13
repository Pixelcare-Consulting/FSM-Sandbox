import { getSupabaseClient } from '../supabase/client';

/**
 * Load enriched job chat messages for JobDetailsPage.
 * @param {string} jobUuid
 * @returns {Promise<object[]>}
 */
export async function fetchJobChatMessages(jobUuid) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  if (!jobUuid || typeof jobUuid !== 'string') {
    return [];
  }

  const { error: simpleError } = await supabase
    .from('job_technician_admin_messages')
    .select('id, job_id, created_at')
    .eq('job_id', jobUuid)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1);

  if (simpleError) {
    throw new Error(simpleError.message || 'Failed to load chat messages');
  }

  const { data: messages, error } = await supabase
    .from('job_technician_admin_messages')
    .select('*')
    .eq('job_id', jobUuid)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message || 'Failed to load chat messages');
  }

  if (!Array.isArray(messages)) {
    return [];
  }

  if (messages.length === 0) {
    return [];
  }

  const technicianJobIds = [
    ...new Set(messages.map((msg) => msg.technician_job_id).filter(Boolean)),
  ];

  let technicianMap = {};
  if (technicianJobIds.length > 0) {
    const { data: technicianJobs, error: techJobError } = await supabase
      .from('technician_jobs')
      .select(`
        id,
        technician_id,
        technician:technician_id(
          id,
          full_name
        )
      `)
      .in('id', technicianJobIds)
      .is('deleted_at', null);

    if (!techJobError && technicianJobs) {
      technicianJobs.forEach((tj) => {
        if (tj.technician?.full_name) {
          technicianMap[tj.id] = tj.technician.full_name;
        }
      });
    }
  }

  const adminIds = [...new Set(messages.map((m) => m.admin_id).filter(Boolean))];
  const adminUserMap = {};
  if (adminIds.length > 0) {
    const { data: adminUsers, error: adminErr } = await supabase
      .from('users')
      .select('id, username')
      .in('id', adminIds)
      .is('deleted_at', null);
    if (!adminErr && adminUsers) {
      adminUsers.forEach((u) => {
        adminUserMap[u.id] = u;
      });
    }
  }

  return messages.map((msg) => {
    const enriched = { ...msg };

    if (msg.sender_type === 'TECHNICIAN' && msg.technician_job_id) {
      if (!enriched.technician_job) {
        enriched.technician_job = {};
      }
      if (!enriched.technician_job.technician) {
        enriched.technician_job.technician = {};
      }
      if (technicianMap[msg.technician_job_id]) {
        enriched.technician_job.technician.full_name = technicianMap[msg.technician_job_id];
      }
    }

    if (msg.sender_type === 'ADMIN' && msg.job_id) {
      if (!enriched.job) enriched.job = {};
      if (!enriched.job.created_by_user) enriched.job.created_by_user = {};
      const adminUser = msg.admin_id ? adminUserMap[msg.admin_id] : null;
      if (msg.admin_id && adminUser) {
        enriched.job.created_by_user.id = msg.admin_id;
        enriched.job.created_by_user.full_name = adminUser.username || 'Admin';
        enriched.job.created_by_user.username = adminUser.username;
      } else {
        enriched.job.created_by_user.full_name = 'Admin';
        enriched.job.created_by_user.username = 'Admin';
      }
    }

    return enriched;
  });
}

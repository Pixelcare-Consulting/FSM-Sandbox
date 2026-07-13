import { requireSession } from '../../../lib/auth/requireSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 30 * 1000;

const TASKS_PANEL_SELECT = `
  id,
  technician_id,
  assignment_status,
  job:job_id(
    id,
    job_name,
    title,
    name,
    status,
    start_date,
    end_date,
    scheduled_start,
    scheduled_end,
    priority,
    customer:customer_id(name, customer_name),
    job_tasks(
      id,
      task_name,
      task_description,
      is_done,
      is_completed,
      type
    )
  )
`;

function tasksPanelCacheKey(workerId) {
  return `notifications-tasks-panel:${workerId}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await requireSession(req, res);
  if (!session) return;

  const workerId = req.query.workerId || session.uid || session.user?.id;
  if (!workerId || Array.isArray(workerId)) {
    return res.status(400).json({ error: 'workerId is required' });
  }

  res.setHeader('Cache-Control', `private, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`);

  const cacheKey = tasksPanelCacheKey(workerId);
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('notifications/tasks-panel (cached)', cached);
    return res.status(200).json(cached);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const { data: technicianRow, error: techLookupError } = await supabase
      .from('technicians')
      .select('id')
      .eq('user_id', workerId)
      .is('deleted_at', null)
      .maybeSingle();

    if (techLookupError) throw techLookupError;

    const technicianId = technicianRow?.id;
    if (!technicianId) {
      const empty = {
        taskCategories: { followUps: [], appointments: [], reminders: [] },
        taskCount: 0,
      };
      setListCache(cacheKey, empty, CACHE_TTL_MS);
      return res.status(200).json(empty);
    }

    const { data: technicianJobs, error: tjError } = await supabase
      .from('technician_jobs')
      .select(TASKS_PANEL_SELECT)
      .eq('technician_id', technicianId)
      .eq('assignment_status', 'ASSIGNED')
      .is('deleted_at', null);

    if (tjError) throw tjError;

    const taskCategories = {
      followUps: [],
      appointments: [],
      reminders: [],
    };

    for (const techJob of technicianJobs || []) {
      const jobData = techJob.job;
      if (!jobData || !['Created', 'In Progress', 'CREATED', 'IN_PROGRESS'].includes(jobData.status)) continue;

      const customer = jobData.customer;
      const customerName =
        (Array.isArray(customer) ? customer[0]?.name : customer?.name) ||
        (Array.isArray(customer) ? customer[0]?.customer_name : customer?.customer_name) ||
        '';

      for (const task of jobData.job_tasks || []) {
        const isDone = task.is_done === true || task.is_completed === true;
        if (isDone) continue;

        const taskWithContext = {
          ...task,
          jobID: jobData.id,
          jobName: jobData.job_name || jobData.name || jobData.title,
          customerName,
          startDate: jobData.scheduled_start || jobData.start_date,
          endDate: jobData.scheduled_end || jobData.end_date,
          priority: jobData.priority || 'Low',
        };

        if (task.type === 'follow-up') {
          taskCategories.followUps.push(taskWithContext);
        } else if (task.type === 'appointment') {
          taskCategories.appointments.push(taskWithContext);
        } else {
          taskCategories.reminders.push(taskWithContext);
        }
      }
    }

    const taskCount = Object.values(taskCategories).reduce((acc, arr) => acc + arr.length, 0);
    const payload = { taskCategories, taskCount };
    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('notifications/tasks-panel', payload);
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[notifications/tasks-panel] error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load tasks panel.',
    });
  }
}

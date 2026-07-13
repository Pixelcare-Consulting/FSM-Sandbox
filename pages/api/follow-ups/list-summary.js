import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { withSession } from '../../../lib/api/withSession';
import {
  SUPABASE_FOLLOWUP_LIST_SELECT,
  applyActiveFollowUpJobFilter,
  applyFollowUpListFilters,
  computeJobFollowUpCounts,
  fetchTechniciansByJobIds,
  formatFollowUpListRow,
} from '../../../lib/followUps/followUpListSummary';
import {
  applyMultiTokenIlikeFilters,
  getListCache,
  logResponseSize,
  paginatedSelect,
  parseSearchTokens,
  setListCache,
} from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 45000;

async function resolveJobIdsForFilters(supabase, { customerSearch, jobNumber }) {
  const customerTerm = String(customerSearch || '').trim();
  const jobTerm = String(jobNumber || '').trim();
  if (!customerTerm && !jobTerm) return null;

  let customerIds = null;
  if (customerTerm) {
    const tokens = parseSearchTokens(customerTerm);
    let customerQuery = supabase
      .from('customer')
      .select('id')
      .is('deleted_at', null);

    if (tokens.length > 0) {
      customerQuery = applyMultiTokenIlikeFilters(customerQuery, tokens, [
        'customer_name',
        'customer_code',
      ]);
    }

    const { data: customers, error } = await customerQuery.limit(200);
    if (error) throw error;
    customerIds = (customers || []).map((c) => c.id).filter(Boolean);
    if (customerIds.length === 0) return [];
  }

  let jobQuery = supabase.from('jobs').select('id').is('deleted_at', null);

  if (customerIds) {
    jobQuery = jobQuery.in('customer_id', customerIds);
  }

  if (jobTerm) {
    const jobTokens = parseSearchTokens(jobTerm);
    if (jobTokens.length > 0) {
      jobQuery = applyMultiTokenIlikeFilters(jobQuery, jobTokens, ['job_number', 'title']);
    }
  }

  const { data: jobs, error: jobsError } = await jobQuery.limit(500);
  if (jobsError) throw jobsError;
  return (jobs || []).map((j) => j.id).filter(Boolean);
}

async function resolveJobIdsForTechnician(supabase, technicianId) {
  if (!technicianId) return [];

  const { data, error } = await supabase
    .from('technician_jobs')
    .select('job_id')
    .eq('technician_id', technicianId)
    .is('deleted_at', null)
    .limit(500);

  if (error) throw error;
  return (data || []).map((row) => row.job_id).filter(Boolean);
}

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 200);
  const status = String(req.query.status || '').trim();
  const type = String(req.query.type || '').trim();
  const followUpId = String(req.query.followUpId || '').trim();
  const assignedWorker = String(req.query.assignedWorker || '').trim();
  const customerSearch = String(req.query.customerSearch || '').trim();
  const jobNumber = String(req.query.jobNumber || '').trim();
  const priority = String(req.query.priority || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();

  const cacheKey = [
    'followups-summary',
    page,
    limit,
    status,
    type,
    followUpId,
    assignedWorker,
    customerSearch,
    jobNumber,
    priority,
    dateFrom,
    dateTo,
  ].join(':');

  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('follow-ups/list-summary (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    let jobIdFilter = null;
    if (customerSearch || jobNumber) {
      jobIdFilter = await resolveJobIdsForFilters(supabase, { customerSearch, jobNumber });
      if (Array.isArray(jobIdFilter) && jobIdFilter.length === 0) {
        const emptyPayload = {
          followUps: [],
          totalCount: 0,
          page,
          limit,
          fetchedAt: new Date().toISOString(),
        };
        setListCache(cacheKey, emptyPayload, CACHE_TTL_MS);
        logResponseSize('follow-ups/list-summary (empty job filter)', emptyPayload);
        return res.status(200).json(emptyPayload);
      }
    }

    let technicianJobIds = [];
    if (assignedWorker && assignedWorker !== 'all') {
      technicianJobIds = await resolveJobIdsForTechnician(supabase, assignedWorker);
    }

    const { data: dbRows, totalCount } = await paginatedSelect(
      supabase,
      'followups',
      SUPABASE_FOLLOWUP_LIST_SELECT,
      {
        page,
        limit,
        order: { column: 'created_at', ascending: false },
        filters: (query) => {
          let q = applyActiveFollowUpJobFilter(query);

          if (followUpId) {
            return q.eq('id', followUpId);
          }

          q = applyFollowUpListFilters(q, { status, type, priority });

          if (dateFrom) {
            q = q.gte('created_at', `${dateFrom}T00:00:00`);
          }

          if (dateTo) {
            q = q.lte('created_at', `${dateTo}T23:59:59`);
          }

          if (Array.isArray(jobIdFilter)) {
            q = q.in('job_id', jobIdFilter);
          }

          if (assignedWorker && assignedWorker !== 'all') {
            if (technicianJobIds.length > 0) {
              q = q.or(
                `technician_id.eq.${assignedWorker},job_id.in.(${technicianJobIds.join(',')})`
              );
            } else {
              q = q.eq('technician_id', assignedWorker);
            }
          }

          return q;
        },
      }
    );

    const jobIds = (dbRows || []).map((row) => row.job_id || row.job?.id).filter(Boolean);
    const technicianJobsByJobId = await fetchTechniciansByJobIds(supabase, jobIds);
    const jobFollowUpCounts = computeJobFollowUpCounts(dbRows || []);

    const followUps = (dbRows || []).map((row) => {
      const jobKey = row.job_id || row.job?.id;
      return formatFollowUpListRow(row, {
        technicianJobsByJobId,
        jobFollowUpCount: jobFollowUpCounts[jobKey] || 1,
      });
    });

    const payload = {
      followUps,
      totalCount,
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize('follow-ups/list-summary', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Follow-ups list-summary API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load follow-ups summary.',
    });
  }
});

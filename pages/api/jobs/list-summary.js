import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { withSession } from '../../../lib/api/withSession';
import {
  SUPABASE_JOB_LIST_BASE_SELECT,
  formatJobListSummaryRow,
  fetchFollowUpsByJobIds,
  fetchTechnicianJobsByJobIds,
} from '../../../lib/jobs/jobListSummary';
import { resolveJobIdsForGlobalSearch } from '../../../lib/jobs/jobListSearch';
import {
  applyJobStatusFilter,
  applyJobStatusValuesFilter,
  loadJobStatusesForFilter,
} from '../../../lib/jobs/jobStatusFilter';
import {
  getListCache,
  invalidateListCache,
  logResponseSize,
  paginatedSelect,
  parseSearchTokens,
  runWithConcurrency,
  setListCache,
} from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_DEFAULT_MS = 120_000;
const CACHE_TTL_SEARCH_MS = 45_000;
const JOB_STATUSES_CACHE_KEY = 'job-statuses-for-filter';
const JOB_STATUSES_CACHE_TTL_MS = 8 * 60 * 1000;
const COUNT_CACHE_TTL_MS = 3 * 60 * 1000;
const SCHEDULE_FETCH_CONCURRENCY = 6;

function buildCountCacheKey({ search, status, statusValues, priority, dateFrom, dateTo, jobId }) {
  return `jobs-summary-count:${search}:${status}:${statusValues}:${priority}:${dateFrom}:${dateTo}:${jobId}`;
}

function resolveListCacheTtl(search, tokens) {
  return tokens.length > 0 || search ? CACHE_TTL_SEARCH_MS : CACHE_TTL_DEFAULT_MS;
}

async function loadCachedJobStatusesForFilter(supabase) {
  const cached = getListCache(JOB_STATUSES_CACHE_KEY, JOB_STATUSES_CACHE_TTL_MS);
  if (cached) return cached;
  const statuses = await loadJobStatusesForFilter(supabase);
  setListCache(JOB_STATUSES_CACHE_KEY, statuses, JOB_STATUSES_CACHE_TTL_MS);
  return statuses;
}

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 200);
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const statusValues = String(req.query.statusValues || '').trim();
  const priority = String(req.query.priority || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const sort = String(req.query.sort || 'created_at');
  const sortAsc = req.query.sortDir === 'asc';
  const jobId = String(req.query.jobId || '').trim();

  const tokens = parseSearchTokens(search);
  const listCacheTtl = resolveListCacheTtl(search, tokens);

  const cacheKey = `jobs-summary:${page}:${limit}:${search}:${status}:${statusValues}:${priority}:${dateFrom}:${dateTo}:${sort}:${sortAsc}:${jobId}`;
  const cached = getListCache(cacheKey, listCacheTtl);
  if (cached) {
    logResponseSize('jobs/list-summary (cached)', cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const jobStatusesForFilter = await loadCachedJobStatusesForFilter(supabase);

    let jobIdFilter = null;
    if (jobId) {
      jobIdFilter = [jobId];
    } else if (tokens.length > 0) {
      jobIdFilter = await resolveJobIdsForGlobalSearch(supabase, search);
      if (Array.isArray(jobIdFilter) && jobIdFilter.length === 0) {
        const emptyPayload = {
          jobs: [],
          totalCount: 0,
          page,
          limit,
          fetchedAt: new Date().toISOString(),
        };
        setListCache(cacheKey, emptyPayload, listCacheTtl);
        logResponseSize('jobs/list-summary (empty job filter)', emptyPayload);
        return res.status(200).json(emptyPayload);
      }
    }

    const sortColumn =
      sort === 'job_number'
        ? 'job_number'
        : sort === 'status'
          ? 'status'
          : 'created_at';

    const countCacheKey = buildCountCacheKey({
      search,
      status,
      statusValues,
      priority,
      dateFrom,
      dateTo,
      jobId,
    });
    const cachedTotalCount = getListCache(countCacheKey, COUNT_CACHE_TTL_MS);

    const applyListFilters = (query) => {
      let q = query;
      if (jobId) {
        return q.eq('id', jobId);
      }
      if (Array.isArray(jobIdFilter)) {
        q = q.in('id', jobIdFilter);
      }
      if (statusValues) {
        q = applyJobStatusValuesFilter(q, statusValues);
      } else if (status && status !== 'all') {
        q = applyJobStatusFilter(q, status, jobStatusesForFilter);
      }
      if (priority && priority !== 'all') {
        q = q.ilike('priority', priority.toUpperCase());
      }
      if (dateFrom) {
        q = q.gte('scheduled_start', `${dateFrom}T00:00:00`);
      }
      if (dateTo) {
        q = q.lte('scheduled_start', `${dateTo}T23:59:59`);
      }
      return q;
    };

    if (tokens.length === 0 && cachedTotalCount != null) {
      const maxPageForCachedCount =
        cachedTotalCount > 0 ? Math.ceil(cachedTotalCount / limit) : 0;
      if (page > maxPageForCachedCount) {
        invalidateListCache(countCacheKey);
        const { totalCount: exactCount } = await paginatedSelect(
          supabase,
          'jobs',
          'id',
          {
            page: 1,
            limit: 1,
            countMode: 'exact',
            filters: applyListFilters,
          }
        );
        const correctedCount = exactCount ?? 0;
        if (correctedCount > 0) {
          setListCache(countCacheKey, correctedCount, COUNT_CACHE_TTL_MS);
        }
        const outOfRangePayload = {
          jobs: [],
          totalCount: correctedCount,
          page,
          limit,
          fetchedAt: new Date().toISOString(),
        };
        logResponseSize('jobs/list-summary (out of range, cached count)', outOfRangePayload);
        return res.status(200).json(outOfRangePayload);
      }
    }

    let countMode =
      tokens.length > 0 ? 'planned' : cachedTotalCount != null ? 'planned' : 'exact';

    const paginatedResult = await paginatedSelect(
      supabase,
      'jobs',
      SUPABASE_JOB_LIST_BASE_SELECT,
      {
        page,
        limit,
        order: { column: sortColumn, ascending: sortAsc },
        countMode,
        filters: applyListFilters,
      }
    );

    const { data: dbRows, totalCount: queriedCount, outOfRange } = paginatedResult;

    if (outOfRange) {
      invalidateListCache(countCacheKey);
      let correctedCount = queriedCount ?? 0;
      if (tokens.length === 0) {
        const { totalCount: exactCount } = await paginatedSelect(
          supabase,
          'jobs',
          'id',
          {
            page: 1,
            limit: 1,
            countMode: 'exact',
            filters: applyListFilters,
          }
        );
        correctedCount = exactCount ?? correctedCount;
        if (correctedCount > 0) {
          setListCache(countCacheKey, correctedCount, COUNT_CACHE_TTL_MS);
        }
      }
      const outOfRangePayload = {
        jobs: [],
        totalCount: correctedCount,
        page,
        limit,
        fetchedAt: new Date().toISOString(),
      };
      logResponseSize('jobs/list-summary (out of range)', outOfRangePayload);
      return res.status(200).json(outOfRangePayload);
    }

    let totalCount = queriedCount;
    if (tokens.length === 0 && cachedTotalCount != null) {
      totalCount = cachedTotalCount;
    } else if (tokens.length === 0 && countMode === 'exact' && queriedCount != null) {
      setListCache(countCacheKey, queriedCount, COUNT_CACHE_TTL_MS);
    }

    const jobIds = (dbRows || []).map((j) => j.id).filter(Boolean);

    const [technicianJobsByJobId, followUpsByJobId] = await Promise.all([
      fetchTechnicianJobsByJobIds(supabase, jobIds),
      fetchFollowUpsByJobIds(supabase, jobIds),
    ]);

    const scheduleIds = (dbRows || [])
      .filter((j) => !j.location_id)
      .map((j) => j.id)
      .filter(Boolean);

    let scheduleAddressByJobId = {};
    if (scheduleIds.length > 0) {
      const chunkSize = 100;
      const batches = [];
      for (let i = 0; i < scheduleIds.length; i += chunkSize) {
        batches.push(scheduleIds.slice(i, i + chunkSize));
      }
      const schedResults = await runWithConcurrency(
        batches.map(
          (idBatch) => async () => {
            const { data: scheduleRows, error } = await supabase
              .from('job_schedule')
              .select('job_id, address')
              .in('job_id', idBatch);
            if (error) {
              console.warn('job_schedule fetch:', error.message);
              return [];
            }
            return scheduleRows || [];
          }
        ),
        SCHEDULE_FETCH_CONCURRENCY
      );
      for (const scheduleRows of schedResults) {
        for (const row of scheduleRows) {
          if (row.job_id && row.address && !scheduleAddressByJobId[row.job_id]) {
            scheduleAddressByJobId[row.job_id] = row.address;
          }
        }
      }
    }

    const jobs = (dbRows || []).map((row) =>
      formatJobListSummaryRow(row, scheduleAddressByJobId, {
        technicianJobsByJobId,
        followUpsByJobId,
      })
    );

    const payload = {
      jobs,
      totalCount,
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, listCacheTtl);
    logResponseSize('jobs/list-summary', payload);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Jobs list-summary API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load jobs summary.',
    });
  }
});

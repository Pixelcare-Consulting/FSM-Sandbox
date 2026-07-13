const PAGE_SIZE = 2000;

function classifyJobStatus(status, jobStatus) {
  const s = String(status || jobStatus || '').toUpperCase();
  const display = String(jobStatus || '').toLowerCase();
  if (s.includes('COMPLET') || display.includes('complete')) return 'completed';
  if (s === 'CREATED' || s === 'PENDING' || display.includes('created')) return 'pending';
  if (s.includes('PROGRESS') || display.includes('progress')) return 'inProgress';
  return 'other';
}

export function getDateRange(period) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let start;

  if (period === 'Today') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'This Week') {
    start = new Date(now);
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'This Month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
  }
  return { start, end };
}

function jobInRange(createdAt, range) {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  return d >= range.start && d <= range.end;
}

function computePeriodStats(jobsInPeriod, dateRange, previousCount = 0) {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const uniqueWorkers = new Set();
  let pendingCount = 0;
  let completedCount = 0;
  let activeCount = 0;
  let newCount = 0;

  for (const job of jobsInPeriod) {
    const status = String(job.status || '').toUpperCase();
    const jobStatus = job.jobStatus || '';
    const createdAt = job.createdAt ? new Date(job.createdAt) : null;

    if (status.includes('PROGRESS') || jobStatus === 'In Progress') {
      for (const tid of job.technicianIds || []) uniqueWorkers.add(tid);
    }
    if (['CREATED', 'PENDING', 'IN_PROGRESS'].includes(status) || ['Created', 'In Progress'].includes(jobStatus)) {
      pendingCount++;
    }
    if (status.includes('COMPLET') || ['Completed', 'Job Complete'].includes(jobStatus)) {
      completedCount++;
    }
    if (status.includes('PROGRESS') || jobStatus === 'In Progress') activeCount++;
    if ((status === 'CREATED' || status === 'PENDING' || jobStatus === 'Created') && createdAt && createdAt >= twentyFourHoursAgo) {
      newCount++;
    }
  }

  const totalFilteredTasks = jobsInPeriod.length;
  const growth =
    previousCount === 0
      ? totalFilteredTasks > 0
        ? 100
        : 0
      : Math.round(((totalFilteredTasks - previousCount) / previousCount) * 100);

  return {
    totalTasks: totalFilteredTasks,
    activeWorkers: uniqueWorkers.size,
    pendingTasks: pendingCount,
    completedTasks: completedCount,
    activeJobsCount: activeCount,
    newJobsCount: newCount,
    taskGrowth: growth,
  };
}

function buildChartForPeriod(period, slimJobs, previousPeriodCount = 0) {
  const range = getDateRange(period);
  const filtered = slimJobs.filter((j) => jobInRange(j.createdAt, range));

  let performanceLabels = [];
  let buckets = [];

  if (period === 'Today') {
    performanceLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    buckets = performanceLabels.map(() => ({ completed: 0, pending: 0, inProgress: 0 }));
    for (const job of filtered) {
      const hour = new Date(job.createdAt).getHours();
      const bucket = classifyJobStatus(job.status, job.jobStatus);
      if (bucket === 'completed') buckets[hour].completed++;
      else if (bucket === 'pending') buckets[hour].pending++;
      else if (bucket === 'inProgress') buckets[hour].inProgress++;
    }
  } else if (period === 'This Week') {
    performanceLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    buckets = performanceLabels.map(() => ({ completed: 0, pending: 0, inProgress: 0 }));
    for (const job of filtered) {
      const dayIndex = new Date(job.createdAt).getDay();
      const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
      const bucket = classifyJobStatus(job.status, job.jobStatus);
      if (bucket === 'completed') buckets[adjustedIndex].completed++;
      else if (bucket === 'pending') buckets[adjustedIndex].pending++;
      else if (bucket === 'inProgress') buckets[adjustedIndex].inProgress++;
    }
  } else if (period === 'This Month') {
    performanceLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
    buckets = performanceLabels.map(() => ({ completed: 0, pending: 0, inProgress: 0 }));
    for (const job of filtered) {
      const weekIndex = Math.min(Math.floor((new Date(job.createdAt).getDate() - 1) / 7), 4);
      const bucket = classifyJobStatus(job.status, job.jobStatus);
      if (bucket === 'completed') buckets[weekIndex].completed++;
      else if (bucket === 'pending') buckets[weekIndex].pending++;
      else if (bucket === 'inProgress') buckets[weekIndex].inProgress++;
    }
  } else {
    performanceLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    buckets = performanceLabels.map(() => ({ completed: 0, pending: 0, inProgress: 0 }));
    for (const job of filtered) {
      const monthIndex = new Date(job.createdAt).getMonth();
      const bucket = classifyJobStatus(job.status, job.jobStatus);
      if (bucket === 'completed') buckets[monthIndex].completed++;
      else if (bucket === 'pending') buckets[monthIndex].pending++;
      else if (bucket === 'inProgress') buckets[monthIndex].inProgress++;
    }
  }

  const distribution = {};
  let unassignedCount = 0;
  let highPriorityCount = 0;
  let overdueScheduledCount = 0;
  const customerIds = new Set();
  const nowRef = new Date();

  for (const job of filtered) {
    const raw = job.status != null && String(job.status).trim() !== '' ? String(job.status).trim() : 'UNKNOWN';
    distribution[raw] = (distribution[raw] || 0) + 1;
    if (!(job.technicianIds || []).length) unassignedCount += 1;
    const p = job.priority != null ? String(job.priority).toUpperCase() : '';
    if (p.includes('HIGH') || p.includes('URGENT') || p === '4' || p === 'H') highPriorityCount += 1;
    if (job.customer_id) customerIds.add(job.customer_id);

    const status = String(job.status || '').toUpperCase();
    const done =
      status.includes('COMPLET') ||
      job.jobStatus === 'Completed' ||
      job.jobStatus === 'Job Complete' ||
      status === 'CANCELLED' ||
      job.jobStatus === 'Cancelled';
    if (!done && job.scheduled_end) {
      const end = new Date(job.scheduled_end);
      if (!Number.isNaN(end.getTime()) && end < nowRef) overdueScheduledCount += 1;
    }
  }

  const stats = computePeriodStats(filtered, range, previousPeriodCount);
  const sortedDist = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
  const periodTotal = filtered.length;
  const completedInPeriod = stats.completedTasks ?? 0;

  return {
    labels: performanceLabels,
    completed: buckets.map((b) => b.completed),
    pending: buckets.map((b) => b.pending),
    inProgress: buckets.map((b) => b.inProgress),
    distribution,
    stats,
    insights: {
      periodTotal,
      topStatusRaw: sortedDist[0]?.[0] ?? null,
      topStatusCount: sortedDist[0]?.[1] ?? 0,
      topStatusPct:
        periodTotal > 0 && sortedDist[0]?.[1]
          ? ((sortedDist[0][1] / periodTotal) * 100).toFixed(1)
          : null,
      completedCount: completedInPeriod,
      completionRatePct:
        periodTotal > 0 ? ((completedInPeriod / periodTotal) * 100).toFixed(1) : '0',
      unassignedCount,
      inProgressInPeriod: stats.activeJobsCount ?? 0,
      highPriorityCount,
      overdueScheduledCount,
      uniqueCustomers: customerIds.size,
    },
  };
}

function mapSlimJobRow(job) {
  const statusMap = {
    COMPLETED: 'Completed',
    IN_PROGRESS: 'In Progress',
    INPROGRESS: 'In Progress',
    PENDING: 'Created',
    CREATED: 'Created',
  };
  const normalizedStatus = job.status || 'PENDING';
  const jobStatus = statusMap[String(normalizedStatus).toUpperCase()] || normalizedStatus;
  const technicianIds = (job.technician_jobs || [])
    .filter((tj) => !tj.deleted_at)
    .map((tj) => tj.technician_id)
    .filter(Boolean);

  return {
    id: job.id,
    status: normalizedStatus,
    jobStatus,
    createdAt: job.created_at,
    scheduled_end: job.scheduled_end,
    priority: job.priority,
    customer_id: job.customer_id,
    technicianIds,
    assignedWorkers: technicianIds.map((id) => ({ id, technician_id: id })),
  };
}

async function fetchSlimJobsInRange(supabase, createdAtFrom) {
  const rows = [];
  let rangeFrom = 0;

  for (;;) {
    let query = supabase
      .from('jobs')
      .select(
        `
        id,
        status,
        created_at,
        scheduled_end,
        priority,
        customer_id,
        technician_jobs(technician_id, assignment_status, deleted_at)
      `
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeFrom + PAGE_SIZE - 1);

    if (createdAtFrom) {
      query = query.gte('created_at', createdAtFrom);
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    rangeFrom += PAGE_SIZE;
  }

  return rows.map(mapSlimJobRow);
}

export async function fetchJobCountInRange(supabase, start, end) {
  const { data, error } = await supabase.rpc('dashboard_job_count_in_range', {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });

  if (!error && data != null) {
    return Number(data) || 0;
  }

  const { count, error: countError } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString());

  if (countError) throw countError;
  return count ?? 0;
}

export async function fetchJobStatusCountsGrouped(supabase) {
  const { data, error } = await supabase.rpc('dashboard_job_status_counts');

  if (!error && Array.isArray(data)) {
    const statusCounts = {};
    let jobCount = 0;
    for (const row of data) {
      const key = row.status != null && String(row.status).trim() !== '' ? String(row.status).trim() : 'UNKNOWN';
      const count = Number(row.job_count) || 0;
      statusCounts[key] = count;
      jobCount += count;
    }
    return { statusCounts, jobCount };
  }

  const statusCounts = {};
  let rangeFrom = 0;

  for (;;) {
    const { data: rows, error: scanError } = await supabase
      .from('jobs')
      .select('status')
      .is('deleted_at', null)
      .range(rangeFrom, rangeFrom + PAGE_SIZE - 1);

    if (scanError) throw scanError;
    if (!rows?.length) break;

    for (const row of rows) {
      const raw = row.status != null && String(row.status).trim() !== '' ? String(row.status).trim() : 'UNKNOWN';
      statusCounts[raw] = (statusCounts[raw] || 0) + 1;
    }

    if (rows.length < PAGE_SIZE) break;
    rangeFrom += PAGE_SIZE;
  }

  const jobCount = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
  return { statusCounts, jobCount };
}

/** Year-bounded slim jobs for chart building (not a full-table scan). */
export async function fetchSlimJobsForOverview(supabase) {
  const yearStart = getDateRange('This Year').start.toISOString();
  return fetchSlimJobsInRange(supabase, yearStart);
}

export async function fetchFollowUpStatusCounts(supabase) {
  const empty = { total: 0, logged: 0, inProgress: 0, closed: 0, cancelled: 0 };

  const { data, error } = await supabase.rpc('dashboard_followup_status_counts');
  if (!error && data && typeof data === 'object') {
    return {
      total: Number(data.total) || 0,
      logged: Number(data.logged) || 0,
      inProgress: Number(data.inProgress) || 0,
      closed: Number(data.closed) || 0,
      cancelled: Number(data.cancelled) || 0,
    };
  }

  const counts = { ...empty };
  let rangeFrom = 0;

  for (;;) {
    const { data: rows, error: scanError } = await supabase
      .from('followups')
      .select('status')
      .is('deleted_at', null)
      .range(rangeFrom, rangeFrom + PAGE_SIZE - 1);

    if (scanError) throw scanError;
    if (!rows?.length) break;

    for (const row of rows) {
      counts.total++;
      const s = String(row.status || '').toUpperCase().replace(/\s+/g, '_');
      if (s === 'LOGGED') counts.logged++;
      else if (s === 'IN_PROGRESS') counts.inProgress++;
      else if (s === 'CLOSED') counts.closed++;
      else if (s === 'CANCELLED') counts.cancelled++;
    }

    if (rows.length < PAGE_SIZE) break;
    rangeFrom += PAGE_SIZE;
  }

  return counts;
}

const OVERVIEW_PERIOD_NAMES = ['Today', 'This Week', 'This Month', 'This Year'];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizePeriodPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const stats = raw.stats || {};
  const insights = raw.insights || {};

  return {
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    completed: Array.isArray(raw.completed) ? raw.completed.map((v) => toNumber(v)) : [],
    pending: Array.isArray(raw.pending) ? raw.pending.map((v) => toNumber(v)) : [],
    inProgress: Array.isArray(raw.inProgress) ? raw.inProgress.map((v) => toNumber(v)) : [],
    distribution: raw.distribution && typeof raw.distribution === 'object' ? raw.distribution : {},
    stats: {
      totalTasks: toNumber(stats.totalTasks),
      activeWorkers: toNumber(stats.activeWorkers),
      pendingTasks: toNumber(stats.pendingTasks),
      completedTasks: toNumber(stats.completedTasks),
      activeJobsCount: toNumber(stats.activeJobsCount),
      newJobsCount: toNumber(stats.newJobsCount),
      taskGrowth: toNumber(stats.taskGrowth),
    },
    insights: {
      periodTotal: toNumber(insights.periodTotal),
      topStatusRaw: insights.topStatusRaw ?? null,
      topStatusCount: toNumber(insights.topStatusCount),
      topStatusPct: insights.topStatusPct ?? null,
      completedCount: toNumber(insights.completedCount),
      completionRatePct: insights.completionRatePct ?? '0',
      unassignedCount: toNumber(insights.unassignedCount),
      inProgressInPeriod: toNumber(insights.inProgressInPeriod),
      highPriorityCount: toNumber(insights.highPriorityCount),
      overdueScheduledCount: toNumber(insights.overdueScheduledCount),
      uniqueCustomers: toNumber(insights.uniqueCustomers),
    },
  };
}

export async function fetchOverviewPeriodsFromRpc(supabase) {
  const { data, error } = await supabase.rpc('dashboard_overview_periods_json');

  if (error) {
    throw error;
  }
  if (!data || typeof data !== 'object') {
    throw new Error('dashboard_overview_periods_json returned invalid payload');
  }

  const periods = {};
  for (const period of OVERVIEW_PERIOD_NAMES) {
    const normalized = normalizePeriodPayload(data[period]);
    if (!normalized) {
      throw new Error(`dashboard_overview_periods_json missing period: ${period}`);
    }
    periods[period] = normalized;
  }

  return periods;
}

/** Preferred path: all 4 period payloads from a single RPC (no slim jobs scan). */
export async function buildOverviewAggregatesFromRpc(supabase, { statusCounts, jobCount }) {
  const periods = await fetchOverviewPeriodsFromRpc(supabase);
  return {
    jobCount,
    statusCounts,
    periods,
  };
}

async function buildPeriodsFromSlimJobs(supabase, slimJobs) {
  const previousCounts = await Promise.all(
    OVERVIEW_PERIOD_NAMES.map(async (period) => {
      const range = getDateRange(period);
      const duration = range.end.getTime() - range.start.getTime();
      const previousStart = new Date(range.start.getTime() - duration);
      return fetchJobCountInRange(supabase, previousStart, range.start);
    })
  );

  const periods = {};
  OVERVIEW_PERIOD_NAMES.forEach((period, index) => {
    periods[period] = buildChartForPeriod(period, slimJobs, previousCounts[index]);
  });

  return periods;
}

/** Fallback path when dashboard_overview_periods_json RPC is unavailable. */
export async function buildOverviewAggregates(supabase, slimJobs, { statusCounts, jobCount }) {
  const periods = await buildPeriodsFromSlimJobs(supabase, slimJobs);
  return {
    jobCount,
    statusCounts,
    periods,
  };
}

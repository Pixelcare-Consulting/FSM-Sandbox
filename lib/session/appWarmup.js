import { readCachedDashboardBootstrap, writeCachedDashboardBootstrap } from '../../utils/dashboardBootstrapCache';
import { readCachedSettingsBundle, writeCachedSettingsBundle } from '../../utils/settingsBundleCache';
import { getDefaultJobsDateRange } from '../jobs/defaultJobsDateRange';
import { queryKeys } from '../cache/queryKeys';
import { fetchJobsList, writeJobsListSessionCache } from '../../hooks/queries/useJobsListQuery';
import { fetchLeadsList } from '../../hooks/queries/useLeadsListQuery';
import { fetchGoogleFormsList } from '../../hooks/queries/useGoogleFormsListQuery';
import { fetchPortalCustomersList } from '../leads/buildPortalCustomersList';
import {
  techniciansCacheKey,
  windowCacheKey,
  writeSchedulerCache,
} from '../scheduler/schedulerCache';
import { computeSchedulerFetchRange } from '../scheduler/schedulerFetchRange';

export const WARMUP_DONE_SESSION_KEY = 'fsm_warmup_done';
/** Shared across tabs; new tabs skip warmup burst while within TTL. */
export const WARMUP_DONE_TTL_MS = 30 * 60 * 1000;

const JOBS_LIST_DEFAULT_LIMIT = 25;
const WORKERS_DEFAULT_LIMIT = 10;
const MASTERLIST_DEFAULT_LIMIT = 100;
const NOTIFICATIONS_DEFAULT_LIMIT = 20;

export const WARMUP_TASKS = [
  { id: 'bootstrap', label: 'Loading dashboard data…' },
  { id: 'settings', label: 'Loading preferences…' },
  { id: 'technicians', label: 'Loading technicians…' },
  { id: 'jobs', label: 'Loading jobs list…' },
  { id: 'workers', label: 'Loading workers…' },
  { id: 'notifications', label: 'Loading notifications…' },
  { id: 'customers', label: 'Loading customers…' },
  { id: 'leads', label: 'Loading leads…' },
  { id: 'scheduler', label: 'Loading schedule…' },
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || `Request failed (${response.status})`);
  }
  return response.json();
}

export function getDefaultWarmupJobsParams() {
  const { start, end } = getDefaultJobsDateRange();
  return {
    page: 1,
    limit: JOBS_LIST_DEFAULT_LIMIT,
    search: '',
    status: '',
    statusValues: '',
    priority: '',
    dateFrom: start || '',
    dateTo: end || '',
  };
}

const PHASE_1_TASK_IDS = ['bootstrap', 'settings'];
const PHASE_2_TASK_IDS = ['technicians', 'jobs', 'notifications'];
const PHASE_3_TASK_IDS = ['scheduler', 'customers', 'leads', 'workers'];
const PHASE_2_MAX_CONCURRENCY = 3;

async function runTask(task, report) {
  try {
    return await task.run();
  } catch (error) {
    console.warn(`[appWarmup] ${task.id} failed:`, error?.message || error);
    return null;
  } finally {
    report(task);
  }
}

async function runTasksWithConcurrency(taskList, maxConcurrency, report) {
  if (!taskList.length) return;
  let index = 0;

  async function worker() {
    while (index < taskList.length) {
      const task = taskList[index];
      index += 1;
      await runTask(task, report);
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrency, taskList.length) },
    () => worker()
  );
  await Promise.all(workers);
}

function scheduleDeferredWork(fn) {
  if (typeof window !== 'undefined' && typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      void fn();
    }, { timeout: 3000 });
    return;
  }
  if (typeof setTimeout === 'function') {
    setTimeout(() => {
      void fn();
    }, 100);
    return;
  }
  void fn();
}

/**
 * Phased prefetch into existing client caches after login.
 * Phase 1 (critical): bootstrap + settings. Phase 2: technicians, jobs, notifications
 * (limited concurrency). Phase 3: scheduler, customers, leads, workers (idle-deferred).
 * Failures are non-blocking.
 *
 * @param {{ queryClient?: import('react-query').QueryClient, onProgress?: (p: { completed: number, total: number, label: string, percent: number, taskId?: string }) => void }} options
 */
export async function runAppWarmup({ queryClient, onProgress } = {}) {
  const tasks = [
    {
      id: 'bootstrap',
      label: WARMUP_TASKS[0].label,
      run: async () => {
        const cached = readCachedDashboardBootstrap();
        if (cached) return cached;
        const data = await fetchJson('/api/session/bootstrap');
        writeCachedDashboardBootstrap(data);
        return data;
      },
    },
    {
      id: 'settings',
      label: WARMUP_TASKS[1].label,
      run: async () => {
        const cached = readCachedSettingsBundle();
        if (cached?.followUp != null) return cached;
        const data = await fetchJson('/api/settings/bundle');
        writeCachedSettingsBundle(data);
        return data;
      },
    },
    {
      id: 'technicians',
      label: WARMUP_TASKS[2].label,
      run: async () => {
        const data = await fetchJson('/api/scheduler/technicians');
        writeSchedulerCache(techniciansCacheKey(), data);
        return data;
      },
    },
    {
      id: 'jobs',
      label: WARMUP_TASKS[3].label,
      run: async () => {
        const params = getDefaultWarmupJobsParams();
        const queryKey = queryKeys.jobsList(params);
        const load = async () => {
          const data = await fetchJobsList(params);
          writeJobsListSessionCache(queryKey, data);
          return data;
        };
        if (queryClient) {
          return queryClient.fetchQuery(queryKey, load);
        }
        return load();
      },
    },
    {
      id: 'workers',
      label: WARMUP_TASKS[4].label,
      run: async () => {
        const params = { page: 1, limit: WORKERS_DEFAULT_LIMIT, search: '' };
        const queryKey = queryKeys.workersList(params);
        const load = () =>
          fetchJson(`/api/workers/summary?page=1&limit=${WORKERS_DEFAULT_LIMIT}`);
        if (queryClient) {
          return queryClient.fetchQuery(queryKey, load);
        }
        return load();
      },
    },
    {
      id: 'notifications',
      label: WARMUP_TASKS[5].label,
      run: () =>
        fetchJson(`/api/notifications/summary?limit=${NOTIFICATIONS_DEFAULT_LIMIT}`),
    },
    {
      id: 'customers',
      label: WARMUP_TASKS[6].label,
      run: async () => {
        const params = { page: 1, limit: MASTERLIST_DEFAULT_LIMIT, search: '' };
        const customersQueryKey = queryKeys.customersList(params);
        const loadCustomers = () =>
          fetchJson(
            `/api/customers/masterlist-summary?page=1&limit=${MASTERLIST_DEFAULT_LIMIT}`
          );
        const loadPortalCustomers = () => fetchPortalCustomersList();
        const loadGoogleForms = () => fetchGoogleFormsList();
        if (queryClient) {
          await Promise.all([
            queryClient.fetchQuery(customersQueryKey, loadCustomers),
            queryClient.fetchQuery(queryKeys.portalCustomersList(), loadPortalCustomers),
            queryClient.fetchQuery(queryKeys.googleFormsList(), loadGoogleForms),
          ]);
          return;
        }
        await Promise.all([loadCustomers(), loadPortalCustomers(), loadGoogleForms()]);
      },
    },
    {
      id: 'leads',
      label: WARMUP_TASKS[7].label,
      run: async () => {
        const params = { page: 1, limit: MASTERLIST_DEFAULT_LIMIT, search: '' };
        const queryKey = queryKeys.leadsList(params);
        const load = () => fetchLeadsList(params);
        if (queryClient) {
          return queryClient.fetchQuery(queryKey, load);
        }
        return load();
      },
    },
    {
      id: 'scheduler',
      label: WARMUP_TASKS[8].label,
      run: async () => {
        const range = computeSchedulerFetchRange('week', new Date());
        const params = new URLSearchParams();
        if (range.start) params.set('rangeStart', range.start);
        if (range.end) params.set('rangeEnd', range.end);
        const data = await fetchJson(`/api/scheduler/technician-data?${params.toString()}`);
        writeSchedulerCache(windowCacheKey(range, false), data);
        return data;
      },
    },
  ];

  const total = tasks.length;
  let completed = 0;

  const report = (task) => {
    completed += 1;
    onProgress?.({
      completed,
      total,
      taskId: task.id,
      label: task.label,
      percent: Math.round((completed / total) * 100),
    });
  };

  onProgress?.({
    completed: 0,
    total,
    taskId: 'start',
    label: WARMUP_TASKS[0].label,
    percent: 0,
  });

  const taskById = Object.fromEntries(tasks.map((task) => [task.id, task]));
  const phase1Tasks = PHASE_1_TASK_IDS.map((id) => taskById[id]);
  const phase2Tasks = PHASE_2_TASK_IDS.map((id) => taskById[id]);
  const phase3Tasks = PHASE_3_TASK_IDS.map((id) => taskById[id]);

  await Promise.all(phase1Tasks.map((task) => runTask(task, report)));
  await runTasksWithConcurrency(phase2Tasks, PHASE_2_MAX_CONCURRENCY, report);

  if (typeof window !== 'undefined') {
    markWarmupDone();
  }

  scheduleDeferredWork(async () => {
    await Promise.allSettled(phase3Tasks.map((task) => runTask(task, report)));
  });
}

function readWarmupDoneTimestamp() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(WARMUP_DONE_SESSION_KEY);
    if (!raw) {
      const legacy = sessionStorage.getItem(WARMUP_DONE_SESSION_KEY);
      if (!legacy) return null;
      const legacyTs = parseInt(legacy, 10);
      return Number.isFinite(legacyTs) ? legacyTs : Date.now();
    }
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

export function markWarmupDone(timestamp = Date.now()) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WARMUP_DONE_SESSION_KEY, String(timestamp));
    sessionStorage.removeItem(WARMUP_DONE_SESSION_KEY);
  } catch {
    // ignore quota
  }
}

export function isWarmupDone() {
  if (typeof window === 'undefined') return true;
  const ts = readWarmupDoneTimestamp();
  if (!ts) return false;
  return Date.now() - ts < WARMUP_DONE_TTL_MS;
}

export function clearWarmupDone() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(WARMUP_DONE_SESSION_KEY);
    sessionStorage.removeItem(WARMUP_DONE_SESSION_KEY);
  } catch {
    // ignore
  }
}

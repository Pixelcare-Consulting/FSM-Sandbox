/**
 * Shared helpers for server-paginated list APIs (egress reduction).
 * Pattern mirrors lib/technicians/workerData.js short-TTL cache.
 */

const DEFAULT_CACHE_TTL_MS = 45000;
const cache = new Map();

export function getListCache(key, ttlMs = DEFAULT_CACHE_TTL_MS) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setListCache(key, value, ttlMs = DEFAULT_CACHE_TTL_MS) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateListCache(prefix) {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Run async task fns with bounded concurrency.
 * @param {Array<() => Promise<unknown>>} taskFns
 * @param {number} limit
 */
export async function runWithConcurrency(taskFns, limit = 6) {
  const results = new Array(taskFns.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < taskFns.length) {
      const i = nextIndex++;
      results[i] = await taskFns[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, taskFns.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function escapeIlike(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Apply AND-of-OR ilike filters (each token must match at least one field).
 * Chained `.or()` calls are ANDed by PostgREST.
 */
export function applyMultiTokenIlikeFilters(query, queryOrTokens, fields) {
  const tokens =
    typeof queryOrTokens === 'string'
      ? parseSearchTokens(queryOrTokens)
      : queryOrTokens || [];
  let q = query;
  for (const token of tokens) {
    const escaped = escapeIlike(token);
    const orParts = fields.map((field) => `${field}.ilike.%${escaped}%`);
    q = q.or(orParts.join(','));
  }
  return q;
}

/**
 * Build PostgREST `and(or(...),or(...))` filter string (legacy helper).
 * Prefer applyMultiTokenIlikeFilters for supabase-js queries.
 */
export function buildMultiTokenIlikeFilter(tokens, fields) {
  const cleaned = (tokens || [])
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (cleaned.length === 0) return null;

  const tokenClauses = cleaned.map((token) => {
    const escaped = escapeIlike(token);
    const orParts = fields.map((field) => `${field}.ilike.%${escaped}%`);
    return `or(${orParts.join(',')})`;
  });

  if (tokenClauses.length === 1) return tokenClauses[0];
  return `and(${tokenClauses.join(',')})`;
}

export function parseSearchTokens(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Paginated select with optional count.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} table
 * @param {string} select
 * @param {object} options
 */
export async function paginatedSelect(supabase, table, select, options = {}) {
  const {
    filters,
    order = { column: 'id', ascending: true },
    page = 1,
    limit = 20,
    countExact = true,
    countMode,
    notDeleted = true,
  } = options;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 500);
  const from = (safePage - 1) * safeLimit;
  const to = from + safeLimit - 1;

  const resolvedCountMode =
    countMode ??
    (countExact === false ? null : countExact === true ? 'exact' : countExact);

  let query = supabase
    .from(table)
    .select(select, resolvedCountMode ? { count: resolvedCountMode } : undefined);

  if (notDeleted) {
    query = query.is('deleted_at', null);
  }

  if (typeof filters === 'function') {
    query = filters(query);
  }

  if (order?.column) {
    query = query.order(order.column, { ascending: order.ascending !== false });
  }

  const { data, error, count } = await query.range(from, to);
  if (error) {
    if (error.code === 'PGRST103') {
      return {
        data: [],
        totalCount: from,
        page: safePage,
        limit: safeLimit,
        outOfRange: true,
      };
    }
    throw error;
  }

  return {
    data: data || [],
    totalCount: count ?? (data?.length || 0),
    page: safePage,
    limit: safeLimit,
  };
}

/**
 * Optional response-size logging for egress diagnostics (read-only, no audit log).
 * Enable with SUPABASE_EGRESS_LOG=1 or { enabled: true }.
 */
export function logResponseSize(label, payload, { enabled } = {}) {
  const shouldLog =
    enabled === true ||
    (enabled !== false && process.env.SUPABASE_EGRESS_LOG === '1');
  if (!shouldLog) return;

  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch {
    bytes = 0;
  }
  const kb = (bytes / 1024).toFixed(1);
  console.log(`[egress] ${label}: ${bytes} bytes (${kb} KB)`);
}

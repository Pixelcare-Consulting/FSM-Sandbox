import { requireSession } from '../../../lib/auth/requireSession';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import {
  buildNotificationsCacheKey,
  NOTIFICATIONS_SUMMARY_SELECT,
  resolveNotificationSubjectIds,
} from '../../../lib/notifications/notificationSummary';
import {
  getListCache,
  logResponseSize,
  paginatedSelect,
  setListCache,
} from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 30000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;

/** Per-instance in-flight dedupe to avoid cache stampede on concurrent misses. */
const inFlightQueries = new Map();

async function loadNotificationsSummaryPayload(supabase, subjectIds, limit, cacheKey) {
  const orClause = `${subjectIds.map((id) => `worker_id.eq.${id}`).join(',')},worker_id.is.null`;

  const { data, totalCount } = await paginatedSelect(
    supabase,
    'notifications',
    NOTIFICATIONS_SUMMARY_SELECT,
    {
      page: 1,
      limit,
      notDeleted: false,
      countExact: true,
      order: { column: 'created_at', ascending: false },
      filters: (query) => query.or(orClause).eq('hidden', false),
    }
  );

  const notifications = data || [];
  const payload = {
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    totalCount,
    limit,
    fetchedAt: new Date().toISOString(),
  };

  setListCache(cacheKey, payload, CACHE_TTL_MS);
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=30');

  const session = await requireSession(req, res);
  if (!session) return;

  const subjectIds = resolveNotificationSubjectIds(req, session);
  if (!subjectIds.length) {
    return res.status(200).json({
      notifications: [],
      unreadCount: 0,
      totalCount: 0,
      limit: DEFAULT_LIMIT,
      fetchedAt: new Date().toISOString(),
    });
  }

  const limit = Math.min(
    Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const cacheKey = buildNotificationsCacheKey(subjectIds, limit);
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('notifications/summary (cached)', cached);
    return res.status(200).json(cached);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  let inFlight = inFlightQueries.get(cacheKey);
  const joinedInFlight = Boolean(inFlight);
  if (!inFlight) {
    inFlight = loadNotificationsSummaryPayload(supabase, subjectIds, limit, cacheKey).finally(() => {
      if (inFlightQueries.get(cacheKey) === inFlight) {
        inFlightQueries.delete(cacheKey);
      }
    });
    inFlightQueries.set(cacheKey, inFlight);
  }

  try {
    const payload = await inFlight;
    logResponseSize(
      joinedInFlight ? 'notifications/summary (singleflight)' : 'notifications/summary',
      payload
    );

    return res.status(200).json(payload);
  } catch (error) {
    if (
      error?.code === 'PGRST116' ||
      error?.code === 'PGRST205' ||
      error?.message?.includes('does not exist') ||
      error?.message?.includes('Could not find the table')
    ) {
      console.warn(
        'notifications/summary: table missing — run create_notifications_table.sql'
      );
      return res.status(200).json({
        notifications: [],
        unreadCount: 0,
        totalCount: 0,
        limit,
        fetchedAt: new Date().toISOString(),
      });
    }

    console.error('notifications/summary API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load notifications summary.',
    });
  }
}

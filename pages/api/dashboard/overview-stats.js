import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { withSession } from '../../../lib/api/withSession';
import {
  buildOverviewAggregates,
  buildOverviewAggregatesFromRpc,
  fetchFollowUpStatusCounts,
  fetchJobStatusCountsGrouped,
  fetchSlimJobsForOverview,
} from '../../../lib/dashboard/overviewAggregates';
import { getListCache, logResponseSize, setListCache } from '../../../lib/supabase/listQueryHelpers';

const CACHE_TTL_MS = 180000;

/** Per-instance in-flight dedupe to avoid cache stampede on concurrent misses. */
const inFlightQueries = new Map();

async function loadOverviewStatsPayload(supabase) {
  const [followUpCounts, statusGrouped] = await Promise.all([
    fetchFollowUpStatusCounts(supabase),
    fetchJobStatusCountsGrouped(supabase),
  ]);

  let aggregates;
  try {
    aggregates = await buildOverviewAggregatesFromRpc(supabase, statusGrouped);
  } catch (rpcError) {
    console.warn(
      '[overview-stats] RPC path failed, falling back to slim jobs scan:',
      rpcError?.message || rpcError
    );
    const slimJobs = await fetchSlimJobsForOverview(supabase);
    aggregates = await buildOverviewAggregates(supabase, slimJobs, statusGrouped);
  }

  return {
    jobCount: aggregates.jobCount,
    statusCounts: aggregates.statusCounts,
    periods: aggregates.periods,
    followUpCounts,
    fetchedAt: new Date().toISOString(),
  };
}

export default withSession(async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Cache-Control', 'private, max-age=120');

  const cacheKey = 'dashboard-overview-stats-v2';
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize('dashboard/overview-stats (cached)', cached);
    return res.status(200).json(cached);
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  let inFlight = inFlightQueries.get(cacheKey);
  const joinedInFlight = Boolean(inFlight);
  if (!inFlight) {
    inFlight = loadOverviewStatsPayload(supabase).finally(() => {
      if (inFlightQueries.get(cacheKey) === inFlight) {
        inFlightQueries.delete(cacheKey);
      }
    });
    inFlightQueries.set(cacheKey, inFlight);
  }

  try {
    const payload = await inFlight;
    if (!joinedInFlight) {
      setListCache(cacheKey, payload, CACHE_TTL_MS);
    }
    logResponseSize(
      joinedInFlight ? 'dashboard/overview-stats (singleflight)' : 'dashboard/overview-stats',
      payload
    );
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Dashboard overview-stats API error:', error);
    return res.status(500).json({
      error: error.message || 'Unable to load dashboard stats.',
    });
  }
});

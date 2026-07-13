import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { withSession } from "../../../lib/api/withSession";
import { fetchWorkerListStats, fetchWorkersListSummary } from "../../../lib/technicians/workerData";
import { getListCache, logResponseSize, setListCache } from "../../../lib/supabase/listQueryHelpers";

const CACHE_TTL_MS = 45000;

export default withSession(async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "private, max-age=30");

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 25), 200);
  const search = String(req.query.search || "").trim();
  const includeStats = req.query.includeStats === "1" || req.query.includeStats === "true";

  const cacheKey = ["workers-summary", page, limit, search, includeStats ? "stats" : ""].join(":");

  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize("workers/summary (cached)", cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    const [{ workers, totalCount }, stats] = await Promise.all([
      fetchWorkersListSummary(supabase, { page, limit, search }),
      includeStats ? fetchWorkerListStats(supabase) : Promise.resolve(null),
    ]);

    const payload = {
      workers,
      totalCount,
      page,
      limit,
      ...(stats ? { stats } : {}),
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize("workers/summary", payload);
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Workers summary API error:", error);
    return res.status(500).json({
      error: error.message || "Unable to load workers summary.",
    });
  }
});

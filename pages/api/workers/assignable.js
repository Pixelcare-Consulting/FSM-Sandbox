import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { fetchAssignableTechnicians } from "../../../lib/technicians/workerData";
import { getListCache, logResponseSize, setListCache } from "../../../lib/supabase/listQueryHelpers";

const CACHE_TTL_MS = 45000;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "private, max-age=30");

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 200), 200);
  const search = String(req.query.search || "").trim();

  const cacheKey = ["workers-assignable", page, limit, search].join(":");

  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  if (cached) {
    logResponseSize("workers/assignable (cached)", cached);
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(503).json({ error: "Database unavailable" });
    }

    const { workers, totalCount } = await fetchAssignableTechnicians(supabase, {
      page,
      limit,
      search,
    });

    const payload = {
      workers,
      totalCount,
      page,
      limit,
      fetchedAt: new Date().toISOString(),
    };

    setListCache(cacheKey, payload, CACHE_TTL_MS);
    logResponseSize("workers/assignable", payload);
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Workers assignable API error:", error);
    return res.status(500).json({
      error: error.message || "Unable to load assignable workers.",
    });
  }
}

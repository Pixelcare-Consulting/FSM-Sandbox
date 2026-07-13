import { getSupabaseAdmin } from "../../../lib/supabase/server";
import {
  loadSchedulerTechniciansForApi,
  SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY,
} from "../../../lib/scheduler/schedulerQueries";
import { getListCache, logResponseSize } from "../../../lib/supabase/listQueryHelpers";

const CACHE_TTL_MS = 15 * 60 * 1000;

/** Per-instance in-flight dedupe for cold-cache stampede. */
const inFlightTechnicianLoads = new Map();

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "private, max-age=30");

  const cached = getListCache(SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY, CACHE_TTL_MS);
  if (cached?.technicians) {
    const payload = {
      technicians: cached.technicians,
      stats: { totalTechnicians: cached.technicians.length },
    };
    logResponseSize("scheduler/technicians (cached)", payload);
    return res.status(200).json(payload);
  }

  let loadPromise = inFlightTechnicianLoads.get(SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY);
  const joinedInFlight = Boolean(loadPromise);

  if (!loadPromise) {
    loadPromise = (async () => {
      const supabase = getSupabaseAdmin();
      const { technicians, error } = await loadSchedulerTechniciansForApi(supabase);
      if (error) throw error;

      return {
        technicians,
        stats: { totalTechnicians: technicians.length },
      };
    })().finally(() => {
      if (inFlightTechnicianLoads.get(SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY) === loadPromise) {
        inFlightTechnicianLoads.delete(SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY);
      }
    });
    inFlightTechnicianLoads.set(SCHEDULER_TECHNICIANS_SERVER_CACHE_KEY, loadPromise);
  }

  try {
    const payload = await loadPromise;
    logResponseSize(
      joinedInFlight ? "scheduler/technicians (singleflight)" : "scheduler/technicians",
      payload
    );
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Scheduler technicians API error", error);
    return res.status(500).json({
      error: error.message || "Unable to load technicians.",
    });
  }
}

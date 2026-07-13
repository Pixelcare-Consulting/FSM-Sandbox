import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { getListCache, setListCache } from "../../../lib/supabase/listQueryHelpers";
import { resolveJobSiteContactMeta } from "../../../lib/scheduler/schedulerSiteContact";
import {
  fetchContactsByCustomerIds,
  fetchCustomerLocationsByCustomerIds,
} from "../../../lib/scheduler/schedulerQueries";

const CACHE_TTL_MS = 60 * 1000;

const JOB_CONTACT_SELECT = `
  id,
  customer_id,
  contact_id,
  customer:customer_id ( id, customer_name, customer_address, phone_number, email ),
  location:location_id ( id, location_name )
`;

function siteContactCacheKey(jobId) {
  return `scheduler-job-site-contact:${jobId}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const jobId = req.query.jobId;
  if (!jobId || Array.isArray(jobId)) {
    return res.status(400).json({ error: "jobId is required" });
  }

  const cacheKey = siteContactCacheKey(jobId);
  const cached = getListCache(cacheKey, CACHE_TTL_MS);
  res.setHeader("Cache-Control", `private, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`);
  if (cached) {
    return res.status(200).json(cached);
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: job, error } = await supabase
      .from("jobs")
      .select(JOB_CONTACT_SELECT)
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw error;
    if (!job) return res.status(404).json({ error: "Job not found" });

    const customerId = job.customer_id;
    if (!customerId) {
      const empty = {};
      setListCache(cacheKey, empty, CACHE_TTL_MS);
      return res.status(200).json(empty);
    }

    const [locsByCustomerId, contactsByCustomerId] = await Promise.all([
      fetchCustomerLocationsByCustomerIds(supabase, [customerId]),
      fetchContactsByCustomerIds(supabase, [customerId]),
    ]);

    const siteMeta = resolveJobSiteContactMeta(job, locsByCustomerId, contactsByCustomerId);
    const payload = siteMeta || {};
    setListCache(cacheKey, payload, CACHE_TTL_MS);
    return res.status(200).json(payload);
  } catch (error) {
    console.error("[SchedulerAPI] job-site-contact", error);
    return res.status(500).json({
      error: error.message || "Unable to load job site contact.",
    });
  }
}

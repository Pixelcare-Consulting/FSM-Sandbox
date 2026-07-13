/**
 * Backfill technician_hours using guarded labor math (matches Supabase fn_compute_technician_labor_hours).
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Usage:
 *   pnpm run labor:backfill
 *   pnpm run labor:backfill -- --dry-run
 *
 * Apply fix_technician_hours_trigger.sql in Supabase first (optional but recommended for future completions).
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import {
  computeTechnicianLaborHours,
  technicianHoursPeriodAnchorIso,
} from "../lib/supabase/computeTechnicianLaborHours.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });
dotenv.config({ path: join(__dirname, "..", ".env") });

const PAGE = 500;
const EMBED = `
  id,
  technician_id,
  deleted_at,
  started_at,
  completed_at,
  accumulated_hours,
  assignment_status,
  job:job_id(scheduled_start, scheduled_end, deleted_at)
`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let offset = 0;
  let processed = 0;
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  console.log(dryRun ? "DRY RUN — no writes" : "Backfilling technician_hours (guarded math)…");

  for (;;) {
    const { data: rows, error } = await supabase
      .from("technician_jobs")
      .select(EMBED)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error("Failed to page technician_jobs:", error.message);
      process.exit(1);
    }
    if (!rows?.length) break;

    for (const row of rows) {
      processed += 1;
      const job = row.job;
      const isDeleted = row.deleted_at != null || job?.deleted_at;
      const status = String(row.assignment_status || "").toUpperCase();
      const anchorIso = technicianHoursPeriodAnchorIso(row);

      if (isDeleted || status !== "COMPLETED" || !anchorIso) {
        if (!dryRun) {
          const { error: delErr } = await supabase
            .from("technician_hours")
            .delete()
            .eq("technician_job_id", row.id);
          if (delErr) {
            failed += 1;
            console.error(`delete ${row.id}:`, delErr.message);
          } else {
            deleted += 1;
          }
        } else {
          skipped += 1;
        }
        continue;
      }

      const labor_hours = computeTechnicianLaborHours({
        started_at: row.started_at,
        completed_at: row.completed_at,
        accumulated_hours: row.accumulated_hours,
        assignment_status: row.assignment_status,
        scheduled_start: job?.scheduled_start,
        scheduled_end: job?.scheduled_end,
      });

      const payload = {
        technician_job_id: row.id,
        technician_id: row.technician_id,
        labor_hours,
        period_anchor_at: anchorIso,
        computed_at: new Date().toISOString(),
      };

      if (dryRun) {
        if (labor_hours > 0) upserted += 1;
        else skipped += 1;
        continue;
      }

      const { error: upErr } = await supabase.from("technician_hours").upsert(payload, {
        onConflict: "technician_job_id",
      });
      if (upErr) {
        failed += 1;
        console.error(`upsert ${row.id}:`, upErr.message);
      } else {
        upserted += 1;
      }
    }

    offset += rows.length;
    console.log(`… processed ${processed}, upserted ${upserted}, deleted ${deleted}, skipped ${skipped}, errors ${failed}`);
    if (rows.length < PAGE) break;
  }

  console.log(
    `Done. processed=${processed} upserted=${upserted} deleted=${deleted} skipped=${skipped} errors=${failed}${dryRun ? " (dry-run)" : ""}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

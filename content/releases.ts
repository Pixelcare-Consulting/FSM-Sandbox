export type ReleaseEntry = {
  version: string;
  date: string;
  title: string;
  notes: string[];
};

/**
 * Portal release log (newest first). Bump package.json version when adding an entry.
 */
export const releases: ReleaseEntry[] = [
  {
    version: '3.15.10',
    date: '2026-07-15',
    title: 'Allow Supabase storage hosts for next/image',
    notes: [
      'next.config.js images.remotePatterns uses **.supabase.co (public storage pathname) so avatars from an older project ref are not rejected when NEXT_PUBLIC_SUPABASE_URL points at another project.',
    ],
  },
  {
    version: '3.15.9',
    date: '2026-07-15',
    title: 'Remove deprecated jsconfig baseUrl',
    notes: [
      'Drop compilerOptions.baseUrl from jsconfig.json — deprecated in TypeScript 6 / removed in 7; paths @/* remain relative to the config directory.',
    ],
  },
  {
    version: '3.15.8',
    date: '2026-07-15',
    title: 'Field BFF login / logout APIs',
    notes: [
      'POST /api/v1/field/login — mobile CORS + metrics; same portal sessionId as /api/login; requires technician profile (403 otherwise).',
      'POST /api/v1/field/logout — Bearer + X-Uid (or cookies) clears users.current_session_id + session cache + cookies.',
      'Shared helpers lib/auth/runPortalLogin.js and runPortalLogout.js; web /api/login and /api/logout rewired (logout now accepts Bearer).',
      'docs/MOBILE_BFF_CONTRACT.md Auth section prefers field login/logout; legacy /api/login still supported.',
    ],
  },
  {
    version: '3.15.7',
    date: '2026-07-14',
    title: 'Consolidate SSR Auth refresh into proxy.js',
    notes: [
      'Remove middleware.js — Next.js 16 requires proxy.js only when both files exist.',
      'Merge portal Supabase Auth JWT cookie refresh into existing proxy.js (portal UI paths only; still excludes /api/v1/field and /api/cron).',
      'Docs updated to reference proxy.js instead of middleware.js for SSR refresh.',
    ],
  },
  {
    version: '3.15.6',
    date: '2026-07-14',
    title: 'Portal SSR Auth refresh + admin client singleton',
    notes: [
      'Add @supabase/ssr for portal page Auth JWT cookie refresh (anon key only; excludes /api/v1/field and /api/cron). Consolidated into root proxy.js in 3.15.7 (Next.js 16 proxy convention).',
      'lib/supabase/ssrBrowser.js + ssrServer.js helpers for Pages; field BFF and requireSession unchanged (Bearer + current_session_id).',
      'database.js reuses getSupabaseAdmin() from server.js on the server path (Turbopack-safe fallback kept).',
      'Docs: SUPABASE_RESOURCE_MONITORING + MOBILE_BFF_CONTRACT clarify singleton admin vs per-user sessions vs SSR refresh (not DB pooling).',
    ],
  },
  {
    version: '3.15.5',
    date: '2026-07-14',
    title: 'Formalize /api/v1/field + jobs meta',
    notes: [
      'Public field BFF path is /api/v1/field/* only; docs/MOBILE_BFF_CONTRACT.md, WORKFLOW, SUPABASE_RESOURCE_MONITORING, and route JSDoc updated (curl Bearer + X-Uid + X-Client-Source example).',
      'GET /api/v1/field/jobs always returns meta.technicianId, assignmentCount, matchedJobCount so empty lists are diagnosable (auth OK vs no assignments).',
      'No unversioned /api/field/* aliases; future breaking changes ship as /api/v2/field/*.',
    ],
  },
  {
    version: '3.15.4',
    date: '2026-07-14',
    title: 'Mobile Next.js BFF + api_timing attribution',
    notes: [
      'Field app BFF under /api/field/* (assignments start/complete/accumulate-hours, jobs list/detail, signatures) with ownership checks and labor contract rules.',
      'requireSession accepts Bearer sessionId + X-Uid; login returns sessionId + technicianId; CORS via MOBILE_CORS_ORIGINS.',
      'withApiMetrics JSON api_timing logs (X-Client-Source: mobile|web|…) on field routes and hot portal paths; portal fetch helpers send X-Client-Source: web.',
      'Contract: docs/MOBILE_BFF_CONTRACT.md; correlate logs with Query Performance via docs/SUPABASE_RESOURCE_MONITORING.md.',
    ],
  },
  {
    version: '3.15.3',
    date: '2026-07-14',
    title: 'Bound scheduler queries + slim detail/notifications',
    notes: [
      'Scheduler window fetches hard-limit dated jobs (1000/query), clamp ranges >62 days, and soft-poll the current window only (less full-cache bust).',
      'Job detail loads via header + parallel slim technician_jobs/tasks/equipments selects (no nested technician(*, user(*))).',
      'Notifications QuickMenu path uses column list instead of select(*).',
      'OFF-PEAK (manual): apply lib/supabase/migrations/add_performance_composite_indexes.sql one CREATE INDEX CONCURRENTLY at a time — covers jobs(scheduled_end), technician_jobs(job_id), notifications, customer_address_details(customer_location_id). Then ANALYZE those tables and recheck Dashboard → Query Performance. See docs/SUPABASE_RESOURCE_MONITORING.md.',
      'Jobs list Realtime left as-is (already patch-first with 30s full-refetch throttle); revisit only if still hot after indexes + scheduler bounds.',
    ],
  },
  {
    version: '3.15.2',
    date: '2026-07-13',
    title: 'Store PayNow QR amount as SGD dollars',
    notes: [
      'jobs.payment_qr_amount is now NUMERIC(12,2) dollars (e.g. 1.20) instead of INTEGER cents.',
      'Autosave / Generate QR write dollars; form load formats dollars with two decimal places.',
      'Convert dollars → cents only at mark-paid and DBS inward-credit matching into job_payments.amount_cents.',
    ],
  },
  {
    version: '3.15.1',
    date: '2026-07-13',
    title: 'Fix In Progress → Quotation in Progress remap',
    notes: [
      'Legacy portal status IN_PROGRESS / "In Progress" now resolves only to the exact SAP label "In Progress".',
      'No longer fuzzy-matches any SAP label containing PROGRESS (e.g. "Quotation in Progress") during sync-to-SAP.',
      'Token fallback requires exact token-set equality so subset labels cannot win.',
    ],
  },
  {
    version: '3.15.0',
    date: '2026-07-01',
    title: 'Baseline',
    notes: ['Prior release baseline before In Progress remap fix.'],
  },
];

export default releases;

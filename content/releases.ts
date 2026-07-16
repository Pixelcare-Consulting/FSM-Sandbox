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
    version: '3.15.21',
    date: '2026-07-16',
    title: 'Fix QuickMenu ref sync during render',
    notes: [
      'Move QuickMenu notification callback ref updates into an effect so React no longer throws "Cannot access refs during render".',
      'Keeps realtime subscriptions reading the latest loadNotifications and patchNotificationFromRealtime callbacks without render-time ref mutation.',
    ],
  },
  {
    version: '3.15.20',
    date: '2026-07-15',
    title: 'Decode HTML &amp; in job location and customer names',
    notes: [
      'resolveJobDisplayAddress now sanitizes ADDRESS tags, location_name, and schedule address so Location panels show & not literal &amp;.',
      'jobDisplayCustomerName / job detail payload decode portal HTML entities in customer display names (e.g. PANASONIC R & D).',
    ],
  },
  {
    version: '3.15.19',
    date: '2026-07-15',
    title: 'Fix Edit Job crash for null location_id',
    notes: [
      'Harden locationSelectOptionLabel so nested address objects are never rendered as React children.',
      'EditJobs only seeds selectedLocation/selectedContact when a real site or contact label exists; mapJobDetailToEditForm returns null for empty locations and normalizes string addresses.',
    ],
  },
  {
    version: '3.15.18',
    date: '2026-07-15',
    title: 'Clear job-detail server cache after follow-up mutations',
    notes: [
      'Follow-up create/edit/status/delete now patch React Query job detail and await invalidateJobDetailSatellites (UUID + job_number aliases) so the 45s server detail cache cannot restore stale notes/status.',
      'Replace bare invalidateQueries on follow-up edit save with setQueryData + satellite invalidation.',
    ],
  },
  {
    version: '3.15.17',
    date: '2026-07-15',
    title: 'Follow-up notes persist + status trim + scheduler freshness',
    notes: [
      'Follow-up inline edit now persists notes; job-detail query invalidated after save.',
      'Follow-up statuses restricted to Quotation In Progress, Quotation Sent, Open, Cancelled (default Open).',
      'Scheduler freshness: stable Realtime channel, client-side range gate, poll only when Realtime down.',
    ],
  },
  {
    version: '3.15.16',
    date: '2026-07-15',
    title: 'TaskList + QuickMenu follow-ups dead-path cleanup',
    notes: [
      'Delete orphan TaskList.js and remove unused jobService.findTasksByJobId.',
      'Strip QuickMenu dead follow-ups quick-summary fetch, followups Realtime channel, and unused tasks-panel query (not rendered in header JSX).',
      'Keep followups in supabase_realtime publication for the follow-ups page; JobDetailsPage uses shared mapJobTasksToTaskList only.',
    ],
  },
  {
    version: '3.15.15',
    date: '2026-07-15',
    title: 'QuickMenu notification fetch dedupe',
    notes: [
      'Remove redundant QuickMenu mount notification fetch; useNotificationsQuery is the sole initial load.',
      'Coalesce concurrent loadNotifications refetches via inFlightLoadRef; bind visibility/route/event listeners through loadNotificationsRef with stable deps.',
      'Merge company logo effects into one bootstrap → localStorage → getCompanyDetails path; drop unused followUpFilters twin state.',
    ],
  },
  {
    version: '3.15.14',
    date: '2026-07-15',
    title: 'Realtime WAL remediation',
    notes: [
      'Align supabase_realtime publication: drop locations + customer_address_details; add followups; keep jobs, technician_jobs, notifications, job_technician_admin_messages.',
      'Remove ineffective client Realtime subscriptions (users, job_schedule, job_tasks, customer_notes).',
      'QuickMenu followups channel scoped to current worker user_id; drop pathname-driven resubscribe.',
      'Stable Realtime channel names in jobs list, follow-ups page, and scheduler (no Date.now()).',
    ],
  },
  {
    version: '3.15.13',
    date: '2026-07-15',
    title: 'Clear remaining dep deprecation advisories',
    notes: [
      'Upgrade @fortawesome/react-fontawesome 0.2 → 3.x (SVG core stays on v6; icons in app still use fas CSS classes).',
      'Upgrade recharts 2 → 3.x and add react-is peer (no app imports today; chart demos remain compatible with v3 default API).',
      'Upgrade uuid 10 → 14 (Node 20+ ESM); existing import { v4 } from \"uuid\" call sites unchanged.',
    ],
  },
  {
    version: '3.15.12',
    date: '2026-07-15',
    title: 'Align ESLint stack with Next.js 16',
    notes: [
      'Upgrade eslint-config-next 14 → 16.2.10 to match next; pin eslint to ^9 (plugins still peer eslint<=9; clears unmet peers from eslint 10).',
      'Migrate .eslintrc.json → eslint.config.mjs flat config; lint script uses eslint .',
    ],
  },
  {
    version: '3.15.11',
    date: '2026-07-15',
    title: 'Align @supabase/supabase-js peer with SSR',
    notes: [
      'Bump @supabase/supabase-js to ^2.108.0 so it meets @supabase/ssr 0.12 peer (^2.108.0); clears unmet peer warning.',
    ],
  },
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

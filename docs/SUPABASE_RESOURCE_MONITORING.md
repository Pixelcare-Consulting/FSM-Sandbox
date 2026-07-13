# Supabase Resource Monitoring & Safe Rollout

Operational checklist for reducing Supabase load spikes, rolling out database changes safely, and verifying improvements after deploy.

## Index DDL — Off-Peak Rollout Checklist

Run index creation during low-traffic windows (evenings/weekends, Singapore time). Avoid applying heavy DDL during active business hours.

### Before rollout

- [ ] Export a baseline log sample: **Dashboard → Logs → API** (or Postgres), save as `docs/supabase_logs.csv`
- [ ] Note current **Query Performance** top queries and p95 latency
- [ ] Confirm no other migrations or index builds are in flight
- [ ] Prepare batched `CREATE INDEX CONCURRENTLY` statements (one index per statement)

### Batch GIN / pg_trgm indexes

- [ ] Apply indexes in **small batches** (1–2 indexes per batch), not all at once
- [ ] Always use `CREATE INDEX CONCURRENTLY` on production tables with live traffic
- [ ] Wait for each index build to finish (`pg_stat_progress_create_index`) before starting the next
- [ ] **Monitor between batches**: CPU, active connections, and API error rate for 5–15 minutes
- [ ] If CPU or connection count spikes, pause until metrics normalize

### After rollout

- [ ] Run `ANALYZE` on affected tables if the planner does not pick up new indexes promptly
- [ ] Re-check Query Performance for improved scan types (index scans vs seq scans)

> **Lesson learned:** `pg_trgm` GIN indexes were once applied on production **during traffic**, which caused a measurable spike in connections and CPU. **Do not repeat** — schedule all trigram/GIN index work off-peak with `CONCURRENTLY` and batch pauses.

---

## Performance Composite Indexes & RLS Fix (2026-07)

Migration files (apply manually in Supabase SQL editor — **do not run during business hours**):

| Order | File | Purpose |
|-------|------|---------|
| 1 | `lib/supabase/migrations/add_performance_composite_indexes.sql` | 9 composite/partial indexes for jobs list, notifications, scheduler |
| 2 | `lib/supabase/migrations/fix_rls_auth_initplan.sql` | `company_memos` RLS: `(select auth.uid())` initplan fix |

### Off-peak rollout steps

1. Export baseline: **Dashboard → Logs → API** (or Postgres) → save as `docs/supabase_logs.csv`
2. Note **Query Performance** top queries and p95 latency (especially jobs list, notifications, scheduler)
3. Confirm no other index builds or migrations are in flight
4. Run **one** `CREATE INDEX CONCURRENTLY` statement from `add_performance_composite_indexes.sql` at a time (Supabase SQL editor does not wrap in a transaction — paste one statement per execution)
5. Wait for each build to finish (`SELECT * FROM pg_stat_progress_create_index;`) before starting the next
6. Pause **5–15 minutes** between batches; monitor CPU, active connections, and API error rate
7. After all 9 indexes complete, run:

```sql
ANALYZE jobs;
ANALYZE notifications;
ANALYZE technician_jobs;
ANALYZE job_schedule;
ANALYZE customer_location;
```

8. Run `fix_rls_auth_initplan.sql` in full (policy DDL is lightweight; safe off-peak)

Suggested batch groupings (pause between batches):

- **Batch A:** `idx_jobs_active_sched_start_created_at`, `idx_jobs_active_sched_end_start`, `idx_jobs_active_undated_created_at`
- **Batch B:** `idx_notifications_worker_hidden_created_at`, `idx_notifications_broadcast_hidden_created_at`, `idx_notifications_worker_hidden_read`
- **Batch C:** `idx_technician_jobs_job_id_active`, `idx_job_schedule_job_id_jsdate`, `idx_customer_location_customer_id_id`

### Post-deploy verification checklist

- [ ] Re-export logs to `docs/supabase_logs.csv` (same filters as baseline)
- [ ] Compare busiest-second request counts (group by second on `timestamp`)
- [ ] **Query Performance:** jobs list query uses index scan on `idx_jobs_active_sched_start_created_at`; reduced `temp_blks_written`
- [ ] **Query Performance:** notifications path uses `worker_id + hidden + created_at`; lower `shared_blks`
- [ ] **Query Performance:** scheduler chunk queries benefit from `technician_jobs` / `job_schedule` / `customer_location` indexes
- [ ] Grep exported logs: no `jobs?...limit=2000` on `/rest/v1/jobs` (overview should use `dashboard_overview_periods_json` RPC)
- [ ] **Smoke test:** login → dashboard → notifications bell → jobs list (default date browse) → scheduler week view
- [ ] Confirm overview charts load via `periods.Today` without slim-jobs fallback warnings in server logs
- [ ] **RLS:** company memos insert (admin) and update (creator / non-restricted) still work from the portal

---

## Post-Deploy Verification

After app or database changes that target request volume or query cost:

1. **Re-export logs** from Supabase (same time window and filters as baseline) to `docs/supabase_logs.csv`
2. **Compare busiest-second request counts** between baseline and post-deploy exports:
   - Group rows by second on the `timestamp` column
   - Compare peak `log_count` / requests-per-second at login and scheduler load
3. **Spot-check routes** that should improve:
   - `/rest/v1/` bursts during login warmup
   - Scheduler-related API paths under `/api/scheduler/`
4. **Functional smoke test**: login, open dashboard, open scheduler week view, open jobs list

Document the before/after peak RPS and date in your deploy notes or MR.

### Baseline vs targets (2026-07-07 login spike)

| Metric | Baseline (`docs/supabase_logs.csv`) | Target after deploy |
|--------|-------------------------------------|---------------------|
| REST calls in first ~3s after login | **36+** | **< 15** in first 5s |
| Busiest single second | **21 requests** | **< 10** |
| Dashboard overview job scan | `jobs?...limit=2000` with nested `technician_jobs` | **None** — use `dashboard_overview_periods_json` RPC |
| Parallel `dashboard_job_count_in_range` | **4×** per overview load | **0** (folded into RPC) |
| Login warmup parallel API hits | **9 concurrent** | **Phased** (2 → 3 → deferred) |
| Scheduler chunk concurrency | **4** | **2** |
| Scheduler server cache TTL | **90s** | **180s** |
| Session `findByIdForSession` dedupe | **None** | **In-flight Map per uid:sessionId** |
| Index DDL during traffic | `pg_trgm` GIN builds in SQL editor | **Off-peak only**, `CONCURRENTLY`, batched |

**How to verify after deploy:** re-export logs to `docs/supabase_logs.csv`, group by second on `timestamp`, grep for `limit=2000` on `/rest/v1/jobs` (should be zero), confirm overview charts load via `periods.Today`, and check server logs for no slim-jobs fallback warnings.

---

## Supabase Dashboard Monitoring Checklist

Review regularly (daily during incidents, weekly in steady state):

### Query Performance

- [ ] Sort by **total time** and **mean time** — identify regressions after deploys
- [ ] Watch for new top queries on `users`, `jobs`, `technician_jobs`, `job_schedules`
- [ ] Check for sequential scans on large tables that should use new indexes

### CPU & memory

- [ ] **Database → Reports → CPU** — sustained >70% warrants investigation
- [ ] Correlate CPU spikes with deploy time, cron jobs, or index builds

### Connections

- [ ] **Database → Reports → Connections** — watch for pool exhaustion or login stampedes
- [ ] Compare peak connections before/after warmup throttling or session-cache changes

### API / Edge logs

- [ ] Filter 5xx and slow requests (`latency` column in exported CSV)
- [ ] Compare error rate during login windows vs off-peak

### Auth

- [ ] Auth health checks should remain 200; spikes in session validation queries should drop after dedupe/cache tuning

---

## Related App-Side Mitigations

These code paths reduce burst load on Supabase (see implementation in repo):

| Area | Change | Purpose |
|------|--------|---------|
| Login warmup | Phased prefetch (`lib/session/appWarmup.js`) | Avoid 9 parallel API hits at login |
| Dashboard overview | `dashboard_overview_periods_json` RPC + singleflight (`pages/api/dashboard/overview-stats.js`) | Replace 2000-row job scan and 4 count RPCs |
| Scheduler API | Lower chunk concurrency, longer server cache | Reduce concurrent PostgREST reads |
| Session validation | In-flight dedupe + 45s TTL cache | One `findByIdForSession` per uid:session per wave |

---

## Escalation

If CPU or connections remain elevated after off-peak index rollout and app deploy:

1. Pause further DDL
2. Capture Query Performance snapshot and `docs/supabase_logs.csv`
3. Review cron/sync jobs and scheduler polling intervals
4. Consider temporary read replica or compute upgrade via Supabase support

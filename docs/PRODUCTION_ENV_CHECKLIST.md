# Production environment checklist

Copy values from [`.env.example`](../.env.example) into your deployment target. Verify **every required variable** before go-live.

---

## Always required (Vercel and custom host)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (client + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase admin access |
| `SAP_SERVICE_LAYER_BASE_URL` | SAP B1 Service Layer base URL |
| `SAP_B1_COMPANY_DB` | SAP company database |
| `SAP_B1_USERNAME` | SAP technical / service user |
| `SAP_B1_PASSWORD` | SAP user password |
| `JWT_SECRET_KEY` | Session / token signing |
| `CRON_SECRET` | Protects `/api/cron/*` routes (Bearer or `?secret=`) |
| `SYNCFUSION_LICENSE_KEY` | Syncfusion components license |

### Integrations (set if feature is used)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps in UI |
| `GOOGLE_GENAI_API_KEY` / `GOOGLE_API_KEY` | Google AI features |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` | Alternative Google auth |
| `AIFM_BASE_URL` + `AIFM_API_TOKEN` | AI-FM Open API integration |
| `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | Qwen / DashScope (optional) |
| `QWEN_MODEL` | Qwen model id (optional) |

### Monitoring (recommended post-deploy)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_EGRESS_LOG` | Set to `1` briefly to log `[egress]` payload sizes on heavy API routes |

### Optional performance

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Shared cache (e.g. company memo ticker) |
| `COMPANY_MEMO_TICKER_CACHE_TTL_SEC` | Memo ticker TTL when Redis is set |

---

## Vercel-specific

1. **Project settings → Environment Variables** — add all variables above for Production (and Preview if needed).
2. **Do not commit** `.env.local` or real secrets to git.
3. **Cron (job sync to SAP)** — see [PHASE2_CRON_SYNC.md](./PHASE2_CRON_SYNC.md):
   - **Pro plan:** optional `vercel.json` crons pointing at `/api/cron/sync-jobs-to-sap`
   - **Hobby plan:** Vercel crons are daily-only; use external scheduler instead (below)
4. **External cron (Hobby or any host)** — set these in Vercel **and** in the external runner:

| Variable | Example / notes |
|----------|-----------------|
| `CRON_SECRET` | Long random string; must match cron caller |
| `JOB_SYNC_CRON_BASE_URL` | `https://your-app.vercel.app/` (trailing slash OK) |
| `JOB_SYNC_CRON_TZ` | `Asia/Manila` (default) |
| `JOB_SYNC_CRON_START_HOUR` | `7` (default) |
| `JOB_SYNC_CRON_END_HOUR` | `24` (default) |

**GitHub Actions:** configure repo secrets `CRON_SECRET` and `JOB_SYNC_CRON_BASE_URL` per [`.github/workflows/job-sync-cron.yml`](../.github/workflows/job-sync-cron.yml).

**Manual / cron-job.org:** hourly GET:

```text
https://YOUR_APP/api/cron/sync-jobs-to-sap?secret=YOUR_CRON_SECRET
```

5. **`vercel.json`** — currently manifest headers only; no auth layer. Page protection uses `proxy.js` / `middleware.js` session indicators + client `useSessionCheck`.

---

## Custom / on-prem host (Render, VM, Docker, etc.)

| Concern | Action |
|---------|--------|
| **Port** | Bind `0.0.0.0:$PORT` (platform-provided `PORT`) |
| **Filesystem** | Ephemeral on Render — no persistent local writes; use Supabase/storage |
| **Env file** | Inject the same variables as the “Always required” table via host secret manager |
| **Cron** | OS cron, Task Scheduler, or GitHub Actions calling `JOB_SYNC_CRON_BASE_URL` + `CRON_SECRET` |
| **Build** | `pnpm install && pnpm run now-build && pnpm run start` (or host-specific start command) |
| **Case sensitivity** | Linux paths are case-sensitive — verify imports and static assets |

---

## Pre-deploy verification

- [ ] All “Always required” variables set on target environment
- [ ] `CRON_SECRET` set and tested against `/api/cron/sync-jobs-to-sap`
- [ ] `JOB_SYNC_CRON_BASE_URL` points to production URL (external cron only)
- [ ] SAP credentials valid for production company DB
- [ ] Supabase migrations applied (`lib/supabase/migrations/`)
- [ ] `pnpm run now-build` passes locally or in CI
- [ ] Manual smoke test (see production readiness plan) completed

---

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — only use on server API routes with `requireSession` / cron secrets.
- Test/debug routes (`/api/test/*`, `test-smtp`, etc.) return **404** when `NODE_ENV=production`.
- Rotate `CRON_SECRET` and `JWT_SECRET_KEY` if ever exposed.

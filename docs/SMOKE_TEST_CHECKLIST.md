# Production smoke test checklist (~15 min)

Run against staging or production **after** `pnpm run now-build` passes and env vars are set. Use a real technician/admin account and DevTools → Network (disable cache).

---

## 1. Sign-in redirect (logged in)

- [ ] While logged in, open `/sign-in` or `/authentication/sign-in`
- [ ] **Expected:** Redirect to `/dashboard/overview` (no blank page)

## 2. Sign-in form (logged out)

- [ ] Log out (or use incognito)
- [ ] Open `/sign-in`
- [ ] **Expected:** Sign-in form visible; no redirect loop

## 3. Root route `/`

- [ ] Logged in: open `/`
- [ ] **Expected:** Lands on overview (not footer-only blank page)
- [ ] Logged out: open `/`
- [ ] **Expected:** Redirect to sign-in (middleware or client guard)

## 4. Core dashboard pages (one bootstrap each)

Navigate each page once; confirm data loads and UI is usable:

- [ ] `/dashboard/overview`
- [ ] Job list (e.g. `/dashboard/jobs` or your jobs index route)
- [ ] Job details (open one job)
- [ ] Settings (e.g. `/dashboard/settings`)
- [ ] Company memos (`/dashboard/company-memos`)

**Network:** Each navigation should trigger **at most one** `/api/session/bootstrap` (or cached identity). No repeated `/api/getUserInfo` spam on every click.

## 5. Session polling intervals

With DevTools Network open on any dashboard page for ~2 minutes:

- [ ] Session renewal (`renewSAPB1Session` or similar) ~**60s**, not every few seconds
- [ ] Session check (`/api/session/status` or probe) ~**30s**, not every 2–4s

## 6. API auth (spot check)

Logged out (incognito), try:

- [ ] `GET /api/jobs/list-summary` → **401** or session error (not 200 with data)
- [ ] `GET /api/dashboard/overview-stats` → **401** or session error
- [ ] `GET /api/test/create-user` → **404** when `NODE_ENV=production`

## 7. Cron (if configured)

- [ ] `GET /api/cron/sync-jobs-to-sap?secret=WRONG` → **401/403**
- [ ] `GET /api/cron/sync-jobs-to-sap?secret=<CRON_SECRET>` → **200** or expected sync response

---

## Sign-off

| Field | Value |
|-------|--------|
| Tester | |
| Date | |
| Environment (staging / prod URL) | |
| Build / commit | |
| Pass / fail | |
| Notes | |

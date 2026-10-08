# GetFunded web app (`apps/web`)

The Next.js 16 app behind getfunded.ai: the marketing site, the free public funder
search, the signed-in workspace, billing and the steward admin. The design reference
is [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md); the tables are in
[`docs/DATA-MODEL.md`](../../docs/DATA-MODEL.md); plan limits are in
[`docs/PLANS.md`](../../docs/PLANS.md). House rules for code live in
[`AGENTS.md`](AGENTS.md).

## 1. Set up

1. Use Node 22 or newer (the scripts use `node --env-file`).
2. `cd apps/web && npm install`.
3. Copy `.env.example` to `.env.local` and fill in the values. Every variable has a
   one-line comment in that file. Never commit a real `.env*` file; `.gitignore`
   already blocks them.
4. `npm run dev` starts the app on http://localhost:3050.

Required to boot: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APP_URL`. Everything else turns a feature on or off
(`ANTHROPIC_API_KEY` for AI, `STRIPE_*` for billing, `ANALYST_DATABASE_URL` for Ask,
`VOYAGE_API_KEY` for semantic search). `SELF_HOSTED=true` puts every workspace on the
internal unlimited plan and hides billing. `AI_MODE=mock` gives a deterministic,
token-free model client for local work and tests.

`TRUST_PROXY=true` tells the app to read the client address from `X-Forwarded-For` /
`X-Real-IP` for the per-IP rate limits. Set it on any self-hosted install that sits
behind a reverse proxy you control (nginx, Caddy, a load balancer); Vercel is trusted
automatically. Off Vercel and without it, those headers are ignored because a client
could write them itself, so every anonymous visitor shares one rate-limit bucket
(30 searches a minute in total). It is also what the Playwright suite sets for
`next start` (section 5).

## 2. Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | development server on port 3050 |
| `npm run build` / `npm start` | production build / serve it on port 3050 |
| `npm run typecheck` | `next typegen` then `tsc --noEmit` |
| `npm run lint` | ESLint (`eslint-config-next`, TypeScript rules) |
| `npm test` | Vitest unit tests (pure helpers, route logic with fakes, migrations on PGlite) |
| `npm run test:watch` | the same, watching |
| `npm run e2e` | Playwright smoke tests against the production build on port 3050 |
| `npm run check` | typecheck, lint, test, build; must stay green on every commit |
| `npm run db:migrate` | apply pending migrations (`-- --status`, `-- --dry-run`, `-- --to 0004`, `-- --force`) |
| `npm run db:ping` | prove `DATABASE_URL` is wired correctly; prints `PASS` or `FAIL` |
| `npm run seed:demo -- --owner you@example.org` | self-host only: one "Demo Food Bank" workspace; `-- --remove` undoes it |

The `db:*` and `seed:*` scripts read `.env.local` through `node --env-file`.

## 3. Database roles and the one-way flow

One Postgres holds two planes. The app can only ever move data in one direction:

1. **Corpus plane** (`internal.*`, `public.*` views, `internal.hybrid_search`): the Open
   Funder Database, written only by the Python pipeline in `corpus/`. The app role has
   SELECT and EXECUTE there and nothing else. This is a grant, not a convention.
2. **Workspace plane** (schema `getfunded`): everything users create. Every table has
   Row Level Security enabled **and forced**. Policies read the caller from
   `current_setting('app.user_id')`.

Roles:

| Role | Logs in | Used by |
| --- | --- | --- |
| `postgres` (or any BYPASSRLS owner) | yes | migrations and the demo seed only (`MIGRATE_DATABASE_URL`) |
| `getfunded_app` | no | holds every grant the app needs; 20 s statement timeout; cannot bypass RLS |
| `getfunded_login` | yes | `DATABASE_URL`; owns nothing, inherits `getfunded_app` |
| `funder_ro` | yes | `ANALYST_DATABASE_URL`; read-only, runs model-written SQL only |

What this guarantees:

- The app never runs as `service_role` or `postgres`. A bug in app code cannot write the
  corpus, cannot read another workspace, and cannot skip a quota.
- `lib/db/app.ts#withUser(userId, fn)` is the only way to query `getfunded.*`. It opens a
  transaction, runs `select set_config('app.user_id', $1, true)` and then your SQL. No
  user id means zero rows, never someone else's rows.
- Append-only tables (`stage_history`, `activities`, `ai_analyses`, `ai_feedback`,
  `send_outcomes`, `events`) have no UPDATE or DELETE grant at all.
- Anything that must run without a signed-in user (provisioning, invites, credit
  reservation, rate limits, the Stripe webhook, API-key lookup, secrets) goes through a
  `SECURITY DEFINER` function ("door") with a pinned `search_path`. The doors are listed
  in `docs/DATA-MODEL.md`.
- Every model call goes through `meter()` in `lib/billing/meter.ts`, and only
  `lib/ai/client.ts` imports the Anthropic SDK. A unit test fails the build if another
  file imports it.
- A failed model call is not free when the model was paid. `meter()` reserves the
  feature's credits, runs the call, and then settles the ledger row with the real
  tokens. When the call threw but the error carries tokens the model billed (a
  refusal, a rejected tool call, a schema failure after the retry), the row is settled
  all the same, with `meta.failed = true`, and the credits stay charged; only a call
  that spent no tokens (the model never answered) is refunded. The admin usage page
  counts those failed-but-spent calls in its model totals.

## 4. Migrations

Plain SQL files in `migrations/getfunded_NNNN_*.sql`, applied in order. Full details
(ledger, hash checks, the roles-block convention) are in
[`migrations/README.md`](migrations/README.md).

First-time setup of a database:

1. Put an owner URL (Supabase `postgres`, or a superuser) in `MIGRATE_DATABASE_URL`.
2. `npm run db:migrate`. 0001 refuses to run without BYPASSRLS.
3. As the owner, once:
   `create role getfunded_login login password '...' in role getfunded_app;`
4. Put the `getfunded_login` URL (Supabase session pooler) in `DATABASE_URL`.
5. `npm run db:ping` must print `PASS`: a corpus read works, a corpus write is refused,
   a `getfunded` write under `set_config` works, an append-only delete is refused.

Adding a migration: next number, same conventions, every `grant`/`revoke` between
`-- @roles-begin` and `-- @roles-end`, idempotent statements, then `npm test` (the
PGlite tests apply the whole directory).

Two migrations change what roles can reach and need a word on deployment:

- **0010, analyst role scope.** `funder_ro` (the role behind "Ask the analyst",
  `ANALYST_DATABASE_URL`) may SELECT exactly what `lib/ai/sql-guard.ts` allows: the
  14 `public.*` views on the guard's allowlist and the 11 `internal.mv_*` materialized
  views, nothing else in `internal`, with `search_path = public`. The 14 are not every
  public view: the database has more (for example `recipient_aliases`,
  `recipient_alias_links`, `irs_revocations`, `irs_pub78` and `org_irs_standing`), and
  the analyst role has no grant on those. The same migration grants `getfunded_app`
  SELECT on two columns of `internal.raw_files` (`id`, `sha256`) so funder pages can
  show the fingerprint of the file a fact was parsed from; the app probes that grant
  once per process and leaves the fingerprint out until it is there, so the app can be
  deployed before or after the migration. Run it as the corpus owner. Then verify:
  `ANALYST_DATABASE_URL=… npm run db:ping` must print `PASS` (it compares the role's
  readable relations with the guard's allowlist and fails on any drift).
- **0011, sign-up gate, invite email binding, ledger reaper.** Adds the doors
  `has_pending_invite(email)` (what `signup_mode = 'invite'` checks before a new
  account is provisioned) and `invite_preview(token)`; replaces `accept_invite(token)`
  so the signed-in email must match the invited address (`invite_wrong_email`); and
  gives `daily_maintenance` a third argument that refunds `usage_ledger` rows left
  `reserved` for longer than the window (`meta.reaped = true`). No new tables; the
  0009 two-argument door keeps working.

## 5. Tests

1. `npm test` runs everything under `tests/unit` in about five seconds. No real
   database, Stripe or Anthropic call is ever made: the migrations run on PGlite (an
   in-process PostgreSQL), SQL is faked with `tests/unit/billing/fake-sql.ts`, and the
   Anthropic SDK is replaced by a fake.
2. `tests/unit/db/*` applies all migrations on PGlite and tests RLS, grants, doors and
   idempotent replay for real (`set local role getfunded_app`). The harness is
   `tests/unit/db/harness.ts`; use `createTestDb()` and `db.asUser(userId, fn)`.
3. Server-only modules can be imported in tests; `vitest.config.mts` maps `server-only`
   to an empty stub. Modules that touch the pool are mocked through one seam,
   `vi.mock("@/lib/billing/db")`.
4. `npm run e2e` runs the Playwright smoke tests against the production build. Build
   first (`npm run build`); the suite then starts `next start` itself, on port 3050,
   with `AI_MODE=mock SELF_HOSTED=true TRUST_PROXY=true APP_URL=http://localhost:3050`
   (`playwright.config.ts`). `TRUST_PROXY=true` matters: off Vercel the app ignores
   `X-Forwarded-For` unless told to trust it, so every request would read as one
   "unknown" address and the whole suite (plus anything else hitting the server)
   would share a single anonymous search bucket (30/min). `next start` fills
   `X-Forwarded-For` from the socket address, so with the flag requests bucket by
   real client address and a test can send its own header. The database variables
   come from your shell or `.env.local`; Playwright browsers must be installed
   (`npx playwright install chromium`). To use another port, set
   `PLAYWRIGHT_BASE_URL=http://localhost:3051`; the server command follows it. A
   server already listening on that port is reused (except in CI), so start it with
   the same four variables if you start it by hand.

## 6. Layout

| Path | Contents |
| --- | --- |
| `app/` | routes: `(auth)` sign-in and welcome, `auth/*` callback and sign-out, `api/*` handlers |
| `components/ui`, `components/data`, `components/shell`, `components/marketing` | design system and primitives (see `AGENTS.md`; register new ones on `/dev/styleguide`) |
| `lib/db` | pools, `withUser`, `DbError` |
| `lib/auth`, `lib/workspace` | Supabase session, provisioning, active workspace |
| `lib/billing`, `lib/plans.ts`, `lib/ratelimit.ts`, `lib/api` | metering, Stripe, quotas, rate limits, API keys |
| `lib/ai` | the single model client (live, mock, disabled) |
| `migrations/`, `scripts/` | SQL migrations and the `db:*` / `seed:*` runners |
| `proxy.ts` | Next.js 16 request proxy: session refresh, `/app` and `/admin` redirects, security headers |

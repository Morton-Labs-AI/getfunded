# GetFunded architecture

One Postgres, two planes, one web app.

```
┌──────────────────────── apps/web (Next.js 16, Vercel or self-hosted) ────────────────────────┐
│  Marketing site      Free public search       Signed-in workspace        Billing + admin      │
│  /, /pricing, /docs  /search, /funder/[id]    /app/**                    /api/billing, /admin │
│          │                   │                        │                          │            │
│          │          lib/db/corpus.ts (read-only)      │   lib/db/app.ts (RLS, set_config)     │
│          │                   │                        │                          │            │
└──────────┼───────────────────┼────────────────────────┼──────────────────────────┼────────────┘
           │                   ▼                        ▼                          ▼
           │   ┌──────── corpus plane ────────┐   ┌──────── workspace plane ───────────────┐
           │   │ internal.* tables + mv_*     │   │ getfunded.* tables (RLS by membership) │
           │   │ public.* views (18)          │   │ auth.users (Supabase Auth)             │
           │   │ internal.hybrid_search()     │   │ usage_ledger, subscriptions, plans     │
           │   │ READ ONLY to the app, always │   │ app role writes here and only here     │
           │   └──────────────────────────────┘   └────────────────────────────────────────┘
           │                   ▲
           ▼                   │
   corpus/ (Python `funderdb`): stage → ingest → embed → export. Writes the corpus plane.
```

## The two planes

**Corpus plane.** The Open Funder Database: `internal.*` tables, 12 `internal.mv_*` materialized
views, 18 `public.*` views, and the functions `internal.hybrid_search` and `internal.similar_orgs`.
Built and refreshed only by the Python pipeline in `corpus/`. The web app has SELECT and EXECUTE
and nothing else. This is enforced by role grants, not by convention.

The 18 public views are the 14 on the analyst allowlist (`lib/ai/sql-guard.ts`), plus four added
on 2026-10-08: `public.recipient_aliases` (corpus migration 0027) and `public.irs_revocations`,
`public.irs_pub78`, `public.org_irs_standing` (corpus migration 0028). The twelfth materialized
view is `internal.mv_org_posture_history` (corpus migration 0029). None of the five new objects
is on the analyst allowlist.

**Workspace plane.** Everything a user or workspace creates: accounts, saved funders, pipeline,
tasks, notes, AI analyses, outreach drafts, usage, subscriptions. Lives in schema `getfunded`
(see [DATA-MODEL.md](DATA-MODEL.md)). Corpus references are soft uuids plus a snapshot of the
name, EIN, type, city and state, so a corpus re-ingest can never orphan workspace rows.

## Greenbook, the second app

`apps/greenbook` (moved from the `open-funder-db-ui` repository in October 2026, history
intact) is the maintainer's dashboard over the same corpus plane: the analyst chat, faceted
browse, type-adaptive profiles, filing reconstructions and the `/data` trust page. Its pages
read as `funder_ro`. Its `/admin` consoles (website enrichment, fund-pair labelling, funder
signals review) are the one place a human writes corpus facts, through `funder_rw`, and they
exist only when `ADMIN_ENABLED=1` on a local machine. Greenbook has no workspace plane and no
sign-in; it is never deployed to the public host.

## Roles

| Role | Login | Used by | Can |
|---|---|---|---|
| `getfunded_app` | no | the web app, via a login role that is `IN ROLE getfunded_app` | SELECT on the 14 allowlisted `public.*` views, the `internal.mv_*` views, `internal.search_documents`, `internal.organizations`, `internal.filings`, `internal.filing_*`, `internal.funding_events`, `internal.funding_programs`, `internal.org_website`, and the two columns `(id, sha256)` of `internal.raw_files` (migration 0010, for the provenance fingerprint; no other column). Three later web migrations add SELECT on: `internal.recipient_aliases`, `internal.recipient_alias_links` and `public.recipient_aliases` (getfunded_0012, why a grant row is linked); `internal.irs_revocations`, `internal.irs_pub78`, `internal.irs_standing_vintage` and `internal.org_irs_standing` (getfunded_0013, IRS standing; the app reads the internal view and is not granted the three `public.irs_*` / `public.org_irs_standing` views); `internal.mv_org_posture_history` and `internal.funder_recipient_turnover` (getfunded_0014, application history). A fourth adds SELECT on `internal.funder_signals`, `internal.funder_signal_orgs` and `internal.signal_sources` (getfunded_0015, funder signals; see [FUNDER-SIGNALS.md](FUNDER-SIGNALS.md)). The app probes each of these grants and shows nothing until it is there, so deploy order does not matter. EXECUTE on `internal.hybrid_search` and `internal.similar_orgs`; full DML on `getfunded.*` under RLS; EXECUTE on `getfunded.*` SECURITY DEFINER doors |
| `getfunded_login` | yes | `DATABASE_URL` | nothing of its own; inherits `getfunded_app` |
| `funder_ro` | yes (exists) | the analyst's model-generated SQL only (`ANALYST_DATABASE_URL`) | read-only at the role level, 15 s statement timeout, `search_path = public`. After migration 0010 it reads exactly the SQL guard's allowlist (`lib/ai/sql-guard.ts`): 14 of the 18 `public.*` views and 11 of the 12 `internal.mv_*` materialized views, nothing else in `internal` (it holds no grant on the objects added by corpus migrations 0027 to 0029); the two search functions read internal tables as the caller and so are not available to it. `npm run db:ping` with `ANALYST_DATABASE_URL` set fails when the role and the allowlist drift |
| `postgres` | yes | migrations only, by a human or CI | everything |

Row Level Security on every `getfunded.*` table. The app opens a transaction and runs
`select set_config('app.user_id', $1, true)` with the verified Supabase Auth user id before any
query. Policies call `getfunded.current_user_id()` and `getfunded.is_member(workspace_id)`.
Nothing in the app ever runs as `service_role`, and the Supabase service key is not in the app's
environment at all.

## Identity

Supabase Auth, magic link (email OTP). The sign-up form asks for name and email only. The
session cookie is managed by `@supabase/ssr`. On first sign-in, `getfunded.provision_user()`
creates the `users` row, a personal workspace on the Free plan, and the owner membership, in one
transaction. `proxy.ts` (the Next.js 16 request proxy) redirects unauthenticated requests under
`/app` and `/admin` to `/signin?next=`.

Server Actions and route handlers check origin (same-origin only), parse bodies with zod, and
bound body size. No route trusts a workspace id from the client without `is_member()`.

## Metering (the cost-control boundary)

Exactly one module imports the Anthropic SDK: `lib/ai/client.ts`, and it is only callable through
`meter()` in `lib/billing/meter.ts`. `meter()`:

1. reads the workspace plan and current-period usage inside a transaction,
2. inserts a `usage_ledger` row with `status='reserved'` for the feature's credit price
   (refusing with `QuotaExceeded` when the monthly or daily limit would be crossed),
3. runs the model call,
4. updates the row to `settled` with real `input_tokens`, `output_tokens`, `model`, `latency_ms`.
   When the call threw, the row is still `settled` (charged, `meta.failed = true`) if the error
   carries tokens the model billed, because the model was paid whether or not the output was
   usable; it is `refunded` only when no tokens were spent (`failureStatus`). The daily reaper
   (migration 0011) refunds rows left `reserved` for over an hour with `meta.reaped = true`.

`SELF_HOSTED=true` puts every workspace on the internal `unlimited` plan (recorded, never
refused). `AI_ENABLED=false` makes `meter()` refuse everything with `AiDisabled`. Plan values
live in `lib/plans.ts` and must match [PLANS.md](PLANS.md).

Rate limits, all token buckets in `getfunded.rate_limits` through `lib/ratelimit.ts`:
anonymous search per IP (30/min), signed-in search per user (120/min), and the metered AI
routes (`/api/ai/*`) per user (20/min), checked before the credit reservation so a failing or
refunded call still counts against the limit. The client address is read from the forwarding
headers only on Vercel or when `TRUST_PROXY=true` (`lib/security.ts`); otherwise every
anonymous request shares one bucket.

## The free public search

`/search` and `/funder/[id]` need no account. They read the corpus plane only:

- name / EIN exact and trigram search over `internal.organizations` (covers all 2.3M orgs
  including public charities, which are not in the vector index),
- faceted browse by org type, state, application posture (`internal.mv_org_application_posture`),
  latest distributions and assets (`internal.mv_org_latest_financials`), NTEE major group,
- an optional IRS standing filter, `standing=hide_revoked`, that leaves out organizations the IRS
  automatically revoked (`internal.org_irs_standing`). Nothing is hidden by default; a revoked
  organization in the results carries a chip instead,
- semantic "funds work like mine" search through `internal.hybrid_search` when a Voyage key is
  configured, keyword fallback with a visible notice when it is not,
- profile: identity, posture ("Accepts applications" / "Funds preselected organizations only" /
  "Not stated in filings"), how to apply from Part XV, latest financials and a multi-year series,
  grants paid with recipients, officers, filer-stated website, public contact channels only
  (`publishability='public'`, role-based inboxes and phones), provenance seal on every fact
  (source dataset, filing object id, raw file sha256),
- three sourced additions to the profile, each of which renders nothing until its data and its
  grant exist: IRS standing with the date of each IRS list (`internal.org_irs_standing`); how a
  foundation answered the application question across its Form 990-PF returns and how many of
  a year's named recipients are not on its three earlier grant lists
  (`internal.mv_org_posture_history`, `internal.funder_recipient_turnover`); and why a grant
  row is linked when the link rests on other filers' returns (`internal.recipient_alias_links`,
  `public.recipient_aliases`). None is written by a model, and none is a score.

Saving a funder, notes, fit analysis and export require sign-in.

## Route map

| Area | Routes | Owner module |
|---|---|---|
| Marketing | `/`, `/pricing`, `/about`, `/open-source`, `/data`, `/privacy`, `/terms`, `/docs`, `/docs/[...slug]` | `app/(marketing)`, `content/docs/*.md` |
| Public search | `/search`, `/funder/[id]`, `/api/search`, `/api/funders/[id]/*` | `app/(public)`, `lib/queries/corpus/*` |
| Auth | `/signin`, `/auth/callback`, `/auth/signout`, `/welcome` | `app/(auth)`, `lib/auth/*` |
| Workspace | `/app`, `/app/search`, `/app/saved`, `/app/pipeline`, `/app/tasks`, `/app/funders/[id]`, `/app/ask`, `/app/outreach`, `/app/reports` | `app/(app)/app`, `lib/workspace/*` |
| Settings | `/app/settings`, `/app/settings/organization`, `/app/settings/members`, `/app/settings/billing`, `/app/settings/api`, `/app/settings/integrations` | `app/(app)/app/settings` |
| AI | `/api/ai/filter`, `/api/ai/fit`, `/api/ai/ask` (SSE), `/api/ai/research`, `/api/ai/draft` | `lib/ai/*`, `lib/billing/meter.ts` |
| Billing | `/api/billing/checkout`, `/api/billing/portal`, `/api/webhooks/stripe` | `lib/billing/*` |
| Public API (Team+) | `/api/v1/search`, `/api/v1/funders/[id]`, `/api/v1/saved` | `lib/api/*`, key auth |
| Admin (steward) | `/admin`, `/admin/workspaces`, `/admin/usage`, `/admin/flags` | `app/(admin)`, `ADMIN_EMAILS` |
| Health | `/api/health` | none |

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `getfunded_login` over the Supabase session pooler |
| `ANALYST_DATABASE_URL` | for Ask | `funder_ro` pooler URL; the only connection that runs model-written SQL |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase Auth (session only; never PostgREST data access) |
| `ANTHROPIC_API_KEY` | for AI | the steward's or self-host operator's key |
| `AI_MODEL_FAST`, `AI_MODEL_DEEP` | no | defaults `claude-sonnet-5-5` and `claude-opus-5-5` |
| `AI_ENABLED` | no | `false` disables all model calls |
| `VOYAGE_API_KEY` | for semantic search | query embeddings, voyage-3.5 at 512 dims to match the index |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_ENTERPRISE` | hosted only | subscriptions |
| `SELF_HOSTED` | no | `true` = unlimited internal plan, no billing UI |
| `APP_URL` | yes | absolute origin for links and origin checks |
| `ADMIN_EMAILS` | no | comma-separated steward logins allowed under `/admin` |
| `SECRETS_KEY` | for Gmail | 32-byte base64 key for AES-256-GCM encryption of integration tokens |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Gmail send | OAuth for Pro+ outreach sending |

## Non-negotiable rules carried into code

- `unknown` is not `closed`. Posture renders "Not stated in filings".
- Missing numbers render "Not available", never "$0". Superseded filings are filtered.
- Contact values render only when `publishability='public'`; the SQL nulls them otherwise.
- Every AI output is labelled AI, cites evidence ids from the package it was given, and is stored
  append-only in `ai_analyses` with a fingerprint of its inputs.
- No private data in the repo: no `.env*` except examples, no contacts, no customer workspaces.
- `npm run check` (typecheck, lint, unit tests, build) stays green on every commit.

# getfunded migrations

Plain SQL, applied in filename order. Each file is one numbered step:

| File | What it creates |
| --- | --- |
| `getfunded_0001_schema_and_roles.sql` | schema `getfunded`, the `getfunded_app` role, corpus read grants, helpers (`current_user_id`, `is_member`, `is_admin`, `is_steward`, `set_updated_at`, `slugify`, `hash_token`, `utc_today`, `period_start`, `period_end`), the migration ledger |
| `getfunded_0002_accounts.sql` | `users`, `workspaces`, `members`, `invites`, `subscriptions`, `api_keys`; doors `provision_user`, `accept_invite` |
| `getfunded_0003_usage.sql` | `usage_ledger` (column-level settle grants), `rate_limits`, view `v_usage_period`; doors `reserve_credits`, `take_token` |
| `getfunded_0004_funders.sql` | `saved_funders`, `stage_history`, `activities`, `tasks`, `knowledge`, `imports`, `collections`, `collection_items`; door `move_stage` |
| `getfunded_0005_ai.sql` | `ai_analyses`, `ai_feedback`; door `mark_latest_analysis` |
| `getfunded_0006_outreach.sql` | `contacts`, `sender_identities`, `secrets`, `messages`, `suppressions`, `send_outcomes`; door `read_secret` |
| `getfunded_0007_steward.sql` | `flags` (seeded `ai_enabled=true`, `signup_mode="open"`), `events`, `plan_overrides` |
| `getfunded_0008_billing_webhook.sql` | (billing owner) doors `apply_subscription` for the Stripe webhook and `verify_api_key` for the public API, both running with no signed-in user |
| `getfunded_0009_steward.sql` | steward policies, doors `set_steward`, `claim_steward`, `daily_maintenance`; two indexes for `/admin` |
| `getfunded_0010_analyst_role_scope.sql` | corpus grants only: `funder_ro` (Ask the analyst) scoped to exactly the SQL guard's allowlist (public views + `internal.mv_*`), its default privileges and `search_path` tightened; `getfunded_app` gets SELECT on `internal.raw_files (id, sha256)` for provenance seals |
| `getfunded_0012_recipient_alias_grants.sql` | corpus grants only: `getfunded_app` gets SELECT on `internal.recipient_alias_links`, `internal.recipient_aliases` and the view `public.recipient_aliases`, so a funder page can say why a grant row carries a link (three or more grant-making charities wrote that name with the organization's EIN). Nothing for `funder_ro`. Apply corpus migration 0027 first: on a database that has the corpus but not 0027 this file stops with an error and records nothing |
| `getfunded_0013_irs_standing_grants.sql` | corpus grants only: `getfunded_app` gets SELECT on `internal.irs_revocations`, `internal.irs_pub78`, `internal.irs_standing_vintage` and `internal.org_irs_standing` (IRS standing on the funder page). Apply corpus migration 0028 first: on a database that has the corpus but not 0028 this file stops with an error and records nothing |
| `getfunded_0014_application_history_grants.sql` | corpus grants only: `getfunded_app` gets SELECT on `internal.mv_org_posture_history` and `internal.funder_recipient_turnover` (the "what its returns show" lines under "Can I apply?" on the funder page). Nothing for `funder_ro`. Apply corpus migration 0029 first: on a database that has the corpus but not 0029 this file stops with an error and records nothing |

Every table has RLS enabled **and forced**. The app never bypasses a policy; it
opens a transaction and runs `select set_config('app.user_id', $1, true)` with
the verified Supabase Auth user id, then queries. No `app.user_id` means no rows.

## Running the migrations

```sh
npm run db:migrate                 # apply everything pending
npm run db:migrate -- --status     # what is applied, what is pending
npm run db:migrate -- --dry-run    # print the plan, change nothing
npm run db:migrate -- --to 0004    # stop after 0004
npm run db:migrate -- --force      # re-apply files whose hash changed since they were applied
```

The runner (`scripts/db-migrate.mjs`) uses `MIGRATE_DATABASE_URL` when set,
otherwise `DATABASE_URL`. **Migrations must run as the object owner** (the
`postgres` role on Supabase, a superuser elsewhere), not as the app's login
role. 0001 refuses a runner without `BYPASSRLS`: every SECURITY DEFINER door
runs as its owner against forced RLS, and only a BYPASSRLS owner can read
membership before the caller is known.

The ledger is `getfunded.schema_migrations(filename, sha256, applied_at)`. A
file that is already applied with the same hash is skipped. A file whose text
changed after it was applied stops the run with exit code 3; `--force`
re-applies it and records the new hash. Every file is idempotent (`create table
if not exists`, `create or replace function`, `drop policy if exists` before
`create policy`, guarded `do` blocks), so a replay on a clean database or a
re-run after a partial failure both work. Each file runs in its own transaction
together with its ledger row, under an advisory lock.

Applying by hand (`psql -f migrations/getfunded_0001_schema_and_roles.sql`)
works too; the ledger table is created by 0001 as well, so the runner and a
manual apply share one table. Insert the ledger row yourself when applying by
hand, or the runner will apply the file again (harmlessly, since it is
idempotent).

## The roles block convention

Role and grant statements are separated from everything else:

```sql
-- @roles-begin
grant select, insert on getfunded.stage_history to getfunded_app;
revoke all on function getfunded.move_stage(uuid, text, int, text) from public;
grant execute on function getfunded.move_stage(uuid, text, int, text) to getfunded_app;
-- @roles-end
```

Rules:

- Every `create role`, `alter role`, `grant` and `revoke` lives between
  `-- @roles-begin` and `-- @roles-end`. Tables, functions, indexes, policies
  and triggers never do. `tests/unit/db/schema.test.ts` enforces this.
- A block tagged `-- @roles-begin corpus` holds grants on corpus objects
  (`internal.*`, `public.*` views) that exist only in the real database. The
  PGlite harness always strips those; it applies the untagged blocks so grant
  behaviour (append-only tables, column grants, `set role getfunded_app`) is
  tested for real. `createTestDb({ roles: "strip" })` strips every block.
- Functions are `SECURITY DEFINER` with `set search_path = getfunded, pg_temp`,
  owned by the runner, `revoke all ... from public` then `grant execute ... to
  getfunded_app`.
- Append-only tables (`stage_history`, `activities`, `ai_analyses`,
  `ai_feedback`, `send_outcomes`, `events`) get `grant select, insert` and
  nothing else. `usage_ledger` gets `insert, select` plus `update` on the settle
  columns only. `secrets` gets `select` on metadata columns only; ciphertext
  comes through `read_secret()`. `workspaces.plan` and `billing_anchor_day` have
  no app `update` grant; they move through `apply_subscription()` (0008).

## Migration 0010: the analyst role and provenance hashes

`getfunded_0010_analyst_role_scope.sql` is a corpus-grants file (one
`-- @roles-begin corpus` block, stripped in PGlite). It does two things:

1. **Scopes `funder_ro`**, the login role behind "Ask the analyst"
   (`ANALYST_DATABASE_URL`), to exactly what `lib/ai/sql-guard.ts` allows: SELECT
   on the 14 `public.*` views and the 11 `internal.mv_*` materialized views,
   nothing else in `internal` (no `contact_channels`, `raw_files`,
   `org_web_facts`, `filing_application_info`, ...). It also removes the default
   privilege that would grant the role every future `internal` table, and sets
   the role's `search_path` to `public` so a bare name can never resolve into
   `internal`. The guard refuses those names first; after 0010 the database
   refuses them too. `internal.similar_orgs` and `internal.hybrid_search` read
   internal tables as the caller (they are not SECURITY DEFINER), so they stop
   working for `funder_ro`; the analyst prompt no longer offers them and the
   funder page keeps calling them through `getfunded_app`. To hand them back
   to the analyst, make them SECURITY DEFINER in the corpus (open-funder-db) or
   grant `funder_ro` SELECT on `internal.search_documents`,
   `internal.organizations` and `internal.funding_programs` and add those names
   to the guard's allowlist and the `db:ping` expectation.
2. **Grants `getfunded_app` SELECT on `internal.raw_files (id, sha256)`**, two
   columns, so funder pages show the fingerprint of the file each fact was
   parsed from. The app probes this grant once per process and leaves the
   fingerprint out until it is there, so the order of deploy and migrate does
   not matter.

Operator notes:

- `funder_ro` is created by the corpus, not by this repo. When the role is
  absent the role steps are skipped with a NOTICE; the raw_files column grant
  still applies.
- `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` and `ALTER ROLE funder_ro SET ...`
  need the migration runner to be that owner (or a superuser, or hold
  CREATEROLE). On Supabase the `postgres` role qualifies. A step without
  privilege raises a NOTICE and the rest of the file still applies.
- Verify with `ANALYST_DATABASE_URL=... npm run db:ping`: it reads the two
  allowlists from `lib/ai/sql-guard.ts` and prints `FAIL` with the extra or
  missing relation names when the live grants differ. The same run checks the
  `raw_files` column grant on the app connection.

## Operator step: the login role

`getfunded_app` is `NOLOGIN` and never gets a password in a shipped file. After
the first migration run, create the login role the web app uses and put its
URL in `DATABASE_URL`:

```sql
create role getfunded_login login password '…' in role getfunded_app;
-- Supabase session pooler: also allow the pooler to authenticate it
-- (Dashboard → Database → Roles, or `alter role getfunded_login with login`).
```

`getfunded_login` owns nothing and holds no grants of its own; it inherits
everything from `getfunded_app`, including the role-level
`statement_timeout = '20s'`. Verify with `npm run db:ping`, which must print
`PASS`: the corpus read works, a corpus write is refused, a `getfunded` write
under `set_config` works, an append-only delete is refused, and the
`internal.raw_files (id, sha256)` grant from 0010 is in place. Set
`ANALYST_DATABASE_URL` as well to check the analyst role (see 0010 above).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run db:migrate` | apply pending migrations (`--status`, `--dry-run`, `--to`, `--force`) |
| `npm run db:ping` | connectivity and boundary proof for `DATABASE_URL`, and for `ANALYST_DATABASE_URL` when set (funder_ro's readable relations must equal the guard's allowlist); prints PASS/FAIL |
| `npm run seed:demo -- --owner you@example.org` | self-host only (`SELF_HOSTED=true`): one "Demo Food Bank" workspace, three saved funders chosen from the corpus by EIN, two tasks; `--remove` undoes it |

The `package.json` entries:

```json
"db:migrate": "node --env-file=.env.local scripts/db-migrate.mjs",
"db:ping": "node --env-file=.env.local scripts/db-ping.mjs",
"seed:demo": "node --env-file=.env.local scripts/seed-demo.mjs"
```

## Conventions the app code relies on

- Compare-and-swap: `update … where id = $1 and version = $2`. The
  `set_updated_at` trigger sets `updated_at` and bumps `version` by one unless
  the statement already changed it, so both `set version = version + 1` and
  leaving it alone yield exactly one bump. Read the new value with `returning
  version`.
- Tokens: `getfunded.hash_token(text)` is sha256 hex, identical to Node's
  `createHash("sha256").update(token).digest("hex")`. Store `invites.token_hash`
  and `api_keys.key_hash` that way.
- Errors raised by doors are matched on `message`: `quota_exceeded` (detail is
  JSON `{scope, used, limit, requested, period_end}`), `stale_version` (detail
  `{expected, actual}`, SQLSTATE `40001`), `invite_invalid`, `invite_used`,
  `invite_expired`, `saved_funder_not_found`, `analysis_not_found`,
  `secret_not_found`, `workspace_not_found`. Permission refusals use SQLSTATE
  `42501`.
- Days are UTC days (`getfunded.utc_today()`); the daily cap and the billing
  period both use it.
- Adding a migration: next number, same conventions, roles block for every
  grant, and run `npm test` (the PGlite tests apply the whole directory).

### 0011: sign-up gate doors, invite email binding, ledger reaper

`getfunded_0011_signup_invites_and_reaper.sql` adds two SECURITY DEFINER doors
for the sign-in flow, `has_pending_invite(email text)` (true when a pending
invite names the address; what `signup_mode = 'invite'` checks before a new
account is provisioned) and `invite_preview(token)` (the invited address,
workspace name, role and status for the signed-in holder of a token). It
replaces `accept_invite(token)` so the caller's `users.email` must match the
invite's email or the door raises `invite_wrong_email`, and it adds a
three-argument `daily_maintenance(retention, stale_send, stale_reservation)`
whose return table gains `ledger_reaped`: `usage_ledger` rows left `reserved`
longer than the window are set to `refunded` with `meta.reaped = true`. The
0009 two-argument door keeps its shape and now delegates to it with a one-hour
window, so a replay of 0009 still applies. Door errors to match on `message`:
`invite_wrong_email`.

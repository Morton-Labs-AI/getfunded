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
under `set_config` works, and an append-only delete is refused.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run db:migrate` | apply pending migrations (`--status`, `--dry-run`, `--to`, `--force`) |
| `npm run db:ping` | connectivity and boundary proof for `DATABASE_URL`; prints PASS/FAIL |
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

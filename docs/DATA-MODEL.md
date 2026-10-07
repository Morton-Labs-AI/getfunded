# Workspace plane data model (schema `getfunded`)

Migrations live in `apps/web/migrations/getfunded_NNNN_*.sql`, plain SQL, applied in order by
`npm run db:migrate` (ledger table `getfunded.schema_migrations`) or by hand. Every table has
`created_at timestamptz default now()`; mutable tables also have `updated_at` kept by the shared
trigger `getfunded.set_updated_at()` and a `version int not null default 1` column that the app
uses for compare-and-swap updates (`where id = $1 and version = $2`).

Every table has RLS enabled and forced. Helpers:

```sql
getfunded.current_user_id() returns uuid      -- nullif(current_setting('app.user_id', true), '')::uuid
getfunded.is_member(ws uuid) returns boolean  -- exists(select 1 from getfunded.members where workspace_id = ws and user_id = current_user_id())
getfunded.is_admin(ws uuid) returns boolean   -- same with role in ('owner','admin')
```

Policies: members may SELECT rows of their workspaces; members may INSERT/UPDATE rows of their
workspaces except where noted; only admins may UPDATE `workspaces` and manage `members`;
append-only tables grant INSERT and SELECT only (no UPDATE/DELETE grants to `getfunded_app`).

## Accounts and plans

| Table | Columns | Notes |
|---|---|---|
| `users` | `id uuid pk` (= `auth.users.id`), `email citext unique`, `display_name text`, `last_seen_at`, `is_steward bool default false` | one row per Supabase Auth user; created by `provision_user()` |
| `workspaces` | `id uuid pk default gen_random_uuid()`, `slug citext unique`, `name text`, `plan text` check in (`free`,`starter`,`pro`,`team`,`enterprise`,`unlimited`), `billing_anchor_day smallint default 1`, `stripe_customer_id text unique`, `profile jsonb default '{}'` (mission, ein, website, state, counties, program_areas[], annual_budget, populations_served[], keywords[]), `settings jsonb default '{}'` (daily_cap_enabled bool, default_stage, timezone), `deleted_at` | `profile` is what the fit engine reads as "the applicant" |
| `members` | `workspace_id fk`, `user_id fk`, `role text` check in (`owner`,`admin`,`member`), `invited_by uuid`, pk (`workspace_id`,`user_id`) | immutable membership keyed to the auth user id |
| `invites` | `id uuid pk`, `workspace_id`, `email citext`, `role`, `token_hash text unique`, `expires_at`, `accepted_at`, `invited_by` | token shown once, stored hashed |
| `subscriptions` | `workspace_id pk`, `stripe_subscription_id text unique`, `plan`, `status text` (`trialing`,`active`,`past_due`,`canceled`,`unpaid`), `current_period_start`, `current_period_end`, `cancel_at_period_end bool`, `raw jsonb` | written only by the Stripe webhook handler; `workspaces.plan` is updated in the same transaction |
| `api_keys` | `id uuid pk`, `workspace_id`, `name`, `key_prefix text`, `key_hash text unique`, `scopes text[] default '{read}'`, `created_by`, `last_used_at`, `revoked_at` | Team and above; plaintext shown once |

## Usage and limits

| Table | Columns | Notes |
|---|---|---|
| `usage_ledger` | `id bigserial pk`, `workspace_id`, `user_id`, `feature text` (`filter`,`ask`,`draft`,`fit`,`research`), `credits int`, `status text` (`reserved`,`settled`,`refunded`), `model text`, `input_tokens int`, `output_tokens int`, `latency_ms int`, `period_start date`, `meta jsonb`, `created_at`, `settled_at` | append-plus-settle: `getfunded_app` has INSERT, SELECT, and UPDATE limited to the columns `status, model, input_tokens, output_tokens, latency_ms, settled_at, meta` via column grants |
| `rate_limits` | `key text pk` (e.g. `ip:1.2.3.4:search`), `tokens numeric`, `updated_at` | token bucket; `getfunded.take_token(key, capacity, refill_per_sec)` SECURITY DEFINER returns boolean |
| `v_usage_period` (view) | `workspace_id`, `period_start`, `credits_used` (sum of reserved+settled), `credits_today` | one query for the usage meter |

`getfunded.reserve_credits(ws uuid, feature text, credits int, monthly_limit int, daily_limit int)`
is a SECURITY DEFINER function that locks the workspace row, computes period and daily totals,
and inserts the `reserved` row or raises `quota_exceeded` with a JSON detail
(`{used, limit, period_end}`). Period start = the billing anchor day in the current month or the
previous month.

## Funders in the workspace

| Table | Columns | Notes |
|---|---|---|
| `saved_funders` | `id uuid pk`, `workspace_id`, `org_id uuid` (soft corpus ref), `snapshot jsonb` (name, ein, org_type, city, state, website), `stage text` default `identified`, `tier smallint` (1-3), `owner_id uuid`, `ask_amount bigint`, `next_action text`, `next_action_due date`, `source_detail text` (why it is on the list), `tags text[]`, `archived_at`, `version`, unique (`workspace_id`,`org_id`) | stages: `identified`, `researching`, `qualified`, `cultivating`, `loi_submitted`, `proposal_submitted`, `awarded`, `declined`, `parked` |
| `stage_history` | `id bigserial`, `saved_funder_id`, `workspace_id`, `from_stage`, `to_stage`, `changed_by`, `note`, `created_at` | append-only |
| `activities` | `id uuid pk`, `workspace_id`, `saved_funder_id`, `kind text` (`note`,`email`,`call`,`meeting`,`letter`,`event`,`system`), `body text`, `occurred_at`, `created_by`, `meta jsonb` | append-only; `system` rows are written by the app (import, AI accepted, message sent) |
| `tasks` | `id uuid pk`, `workspace_id`, `saved_funder_id` nullable, `title`, `details`, `due_date`, `assignee_id`, `status text` (`open`,`done`,`canceled`), `completed_at`, `created_by`, `version` | |
| `knowledge` | `id uuid pk`, `workspace_id`, `kind text` (`fact`,`program`,`outcome`,`boilerplate`), `title`, `body`, `approved bool default false`, `approved_by`, `approved_at`, `created_by`, `version` | only `approved=true` rows ever enter a prompt |
| `imports` | `id uuid pk`, `workspace_id`, `filename`, `row_count`, `matched`, `unmatched`, `report jsonb`, `created_by` | CSV import report; never silently merges |
| `collections` | `id uuid pk`, `workspace_id`, `name`, `description`, `is_shared bool`, `created_by`, `version` | named lists |
| `collection_items` | `collection_id`, `saved_funder_id`, `position int`, pk both | |

## AI output (append-only)

| Table | Columns | Notes |
|---|---|---|
| `ai_analyses` | `id uuid pk`, `workspace_id`, `saved_funder_id` nullable, `org_id`, `kind text` (`fit`,`research`,`summary`), `model`, `prompt_version text`, `weights_version text`, `input_fingerprint text`, `evidence jsonb` (the package given to the model, with ids), `output jsonb` (zod-validated; every reason cites evidence ids), `score numeric`, `rating text`, `is_latest bool`, `is_mock bool default false`, `usage_ledger_id bigint`, `created_by`, `created_at` | INSERT + SELECT only; `is_latest` flips through `getfunded.mark_latest_analysis()` SECURITY DEFINER; mock output lives in its own namespace and is never reused for a real request |
| `ai_feedback` | `id bigserial`, `analysis_id`, `workspace_id`, `verdict text` (`accepted`,`edited`,`dismissed`), `edited_output jsonb`, `created_by`, `created_at` | append-only |

## Outreach (Pro and above for sending; drafting on every plan)

| Table | Columns | Notes |
|---|---|---|
| `contacts` | `id uuid pk`, `workspace_id`, `saved_funder_id`, `full_name`, `title`, `email citext`, `phone`, `source text` (`filing_part_xv`,`manual`,`import`,`web`), `source_url`, `publishability text`, `version` | the workspace's own contact rows; corpus public contacts are copied here with `source='filing_part_xv'` only when the user clicks "Use this contact" |
| `sender_identities` | `id uuid pk`, `workspace_id`, `user_id`, `email citext`, `display_name`, `provider text` (`gmail`), `status text`, `daily_cap int default 50`, `version` | tokens live in `secrets`, never here |
| `secrets` | `id uuid pk`, `workspace_id`, `owner_user_id`, `kind text` (`gmail_refresh_token`,`api_key_hash`), `ciphertext bytea`, `iv bytea`, `tag bytea`, `key_version int`, `version` | AES-256-GCM with `SECRETS_KEY`; SELECT only through `getfunded.read_secret()` guarded by owner |
| `messages` | `id uuid pk`, `workspace_id`, `saved_funder_id`, `contact_id`, `sender_identity_id`, `channel text` (`email`,`letter`,`linkedin`,`other`), `subject`, `body`, `draft_source text` (`template`,`ai`), `ai_analysis_id`, `status text` (`draft`,`approved`,`sending`,`sent`,`failed`,`canceled`,`recorded`), `approved_by`, `approved_at`, `idempotency_key text unique`, `provider_message_id`, `thread_id`, `sent_at`, `error text`, `version` | a message is sent only when `status='approved'`, the contact is not suppressed, the daily cap allows it, and the runner has reconciled interrupted sends |
| `suppressions` | `workspace_id`, `kind text` (`email`,`domain`), `value citext`, `reason`, `created_by`, pk (`workspace_id`,`kind`,`value`) | checked at approve time and at send time |
| `send_outcomes` | `id bigserial`, `message_id`, `workspace_id`, `outcome text` (`accepted`,`bounced`,`replied`,`failed`), `provider_payload jsonb`, `created_at` | append-only; a `replied` outcome cancels every pending follow-up to that contact |

## Steward and telemetry

| Table | Columns | Notes |
|---|---|---|
| `flags` | `key text pk`, `value jsonb`, `updated_by`, `updated_at` | `ai_enabled`, `signup_mode` (`open`,`invite`,`closed`), `banner` |
| `events` | `id bigserial`, `workspace_id` nullable, `user_id` nullable, `name text`, `props jsonb`, `created_at` | append-only product telemetry, pruned after 12 months |
| `plan_overrides` | `workspace_id pk`, `monthly_credits int`, `members int`, `note`, `set_by`, `updated_at` | steward-granted exceptions (pilot nonprofits) |

## Functions (SECURITY DEFINER, owned by `postgres`, EXECUTE granted to `getfunded_app`)

| Function | Purpose |
|---|---|
| `provision_user(auth_user_id uuid, email text, display_name text) returns table(user_id uuid, workspace_id uuid, is_new bool)` | first sign-in: user, personal workspace (slug from name), owner membership |
| `reserve_credits(ws, feature, credits, monthly_limit, daily_limit) returns bigint` | atomic reservation, raises `quota_exceeded` |
| `take_token(key text, capacity numeric, refill_per_sec numeric) returns bool` | token bucket for rate limiting |
| `mark_latest_analysis(analysis_id uuid) returns void` | flips `is_latest` within (workspace_id, org_id, kind) |
| `move_stage(saved_funder_id uuid, to_stage text, expected_version int, note text) returns int` | CAS stage move plus `stage_history` row plus `activities` system row; returns new version |
| `accept_invite(token text) returns uuid` | hashes, checks expiry, inserts membership for `current_user_id()` |
| `read_secret(secret_id uuid) returns table(ciphertext bytea, iv bytea, tag bytea, key_version int)` | only the owner or a workspace admin |

## Seeds

None in production. `npm run seed:demo` (self-host only) creates one workspace "Demo Food Bank"
with a profile, three saved funders chosen from the corpus by EIN, and two tasks, all labelled
demo and all removable with `npm run seed:demo -- --remove`.

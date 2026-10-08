-- getfunded_0001: the getfunded schema, the getfunded_app role, and the helpers
-- every later migration leans on.
--
-- Two planes, one database. The corpus plane (internal.*, public.* views) is
-- READ ONLY to this application forever; that is enforced here by the ABSENCE
-- of any write grant, not by convention. The workspace plane is schema
-- getfunded: everything a user or workspace creates lives here, under Row
-- Level Security keyed on membership.
--
-- Roles:
--   getfunded_app    NOLOGIN, NOBYPASSRLS. A grant container. The web app
--                    connects as a login role that is IN ROLE getfunded_app
--                    (operator step, see migrations/README.md). Never gets a
--                    password in a shipped file.
--   <runner>         Whoever applies migrations (postgres on Supabase, a
--                    superuser elsewhere). Owns every object. Must hold
--                    BYPASSRLS: every SECURITY DEFINER door below runs as the
--                    owner against FORCED RLS, and only a BYPASSRLS owner can
--                    read membership rows before the caller is known.
--
-- Role and grant statements live between `-- @roles-begin` and `-- @roles-end`
-- markers. The PGlite test harness strips the blocks tagged `corpus` (they
-- reference internal.* objects that only exist in the real database) and
-- applies the rest. Keep every GRANT, REVOKE, CREATE ROLE and ALTER ROLE inside
-- a marked block; keep every table, function, policy and index outside one.
--
-- Idempotent: safe to replay on a clean vanilla Postgres (15+) and on the live
-- cluster. Statements that cannot be made cheaply idempotent are guarded by
-- `do` blocks.

-- ---------------------------------------------------------------------------
-- Preconditions
-- ---------------------------------------------------------------------------
do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'getfunded needs PostgreSQL 15 or newer (security_invoker views); found %',
      current_setting('server_version');
  end if;
  if not exists (
    select 1 from pg_roles
    where rolname = current_user and (rolsuper or rolbypassrls)
  ) then
    raise exception 'the migration runner (%) must be a superuser or hold BYPASSRLS: the SECURITY DEFINER doors in schema getfunded run as their owner against forced row level security', current_user;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Extensions. On Supabase both already live in schema `extensions`, which is
-- on the database search_path; on vanilla Postgres they land in `public`.
-- gen_random_uuid() and sha256() are core since PG13/PG11, so pgcrypto is a
-- compatibility courtesy rather than a hard dependency.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create extension if not exists citext with schema extensions';
    execute 'create extension if not exists pgcrypto with schema extensions';
  else
    execute 'create extension if not exists citext';
    execute 'create extension if not exists pgcrypto';
  end if;
  if to_regtype('citext') is null then
    raise exception 'citext is installed but not visible on search_path (%); add its schema to the runner search_path and retry',
      current_setting('search_path');
  end if;
end $$;

create schema if not exists getfunded;

-- The migration ledger. scripts/db-migrate.mjs creates this too, so applying
-- by hand and applying with the runner share one table.
create table if not exists getfunded.schema_migrations (
  filename   text        primary key,
  sha256     text        not null,
  applied_at timestamptz not null default now()
);
alter table getfunded.schema_migrations enable row level security;
alter table getfunded.schema_migrations force row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The identity channel. The app runs `select set_config('app.user_id', $1,
-- true)` inside a transaction with the verified Supabase Auth user id. Unset
-- means NULL, and NULL denies everywhere: forgetting set_config yields an
-- empty result, never someone else's rows.
create or replace function getfunded.current_user_id() returns uuid
language sql stable
set search_path = getfunded, pg_temp
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Membership probes are SECURITY DEFINER so a policy on saved_funders can ask
-- "is this caller in this workspace?" without re-entering the members policy
-- (which would be infinite recursion). The owner bypasses RLS; see the runner
-- precondition above. plpgsql rather than sql because the tables they read are
-- created in 0002 and a sql-language body is validated at creation time.
create or replace function getfunded.is_member(ws uuid) returns boolean
language plpgsql stable security definer
set search_path = getfunded, pg_temp
as $$
begin
  return exists (
    select 1 from getfunded.members m
    where m.workspace_id = ws and m.user_id = getfunded.current_user_id()
  );
end $$;

create or replace function getfunded.is_admin(ws uuid) returns boolean
language plpgsql stable security definer
set search_path = getfunded, pg_temp
as $$
begin
  return exists (
    select 1 from getfunded.members m
    where m.workspace_id = ws
      and m.user_id = getfunded.current_user_id()
      and m.role in ('owner', 'admin')
  );
end $$;

-- The steward (hosted-service operator) reads across workspaces under /admin.
-- Set only by a migration or by hand; the app has no UPDATE grant on it.
create or replace function getfunded.is_steward() returns boolean
language plpgsql stable security definer
set search_path = getfunded, pg_temp
as $$
begin
  return exists (
    select 1 from getfunded.users u
    where u.id = getfunded.current_user_id() and u.is_steward
  );
end $$;

-- Shared BEFORE UPDATE trigger. Sets updated_at and, when the table has a
-- version column that the statement did not already change, bumps it. The app
-- does compare-and-swap with `where id = $1 and version = $2`; either spelling
-- (`set version = version + 1` or leaving it alone) yields exactly one bump.
create or replace function getfunded.set_updated_at() returns trigger
language plpgsql
set search_path = getfunded, pg_temp
as $$
declare
  j_new jsonb := to_jsonb(new);
  j_old jsonb := to_jsonb(old);
  patch jsonb := jsonb_build_object('updated_at', now());
begin
  if j_new ? 'version' and (j_new ->> 'version') = (j_old ->> 'version') then
    patch := patch || jsonb_build_object('version', coalesce((j_old ->> 'version')::int, 0) + 1);
  end if;
  new := jsonb_populate_record(new, patch);
  return new;
end $$;

-- Lower-case ASCII slug from a display name: "Demo Food Bank" -> "demo-food-bank".
create or replace function getfunded.slugify(src text) returns text
language sql immutable
set search_path = getfunded, pg_temp
as $$
  select coalesce(
    nullif(btrim(regexp_replace(lower(coalesce(src, '')), '[^a-z0-9]+', '-', 'g'), '-'), ''),
    'workspace'
  )
$$;

-- One hash for every bearer token stored in this schema (invite tokens, API
-- keys). sha256 hex, so Node's crypto.createHash('sha256').digest('hex')
-- produces the identical string.
create or replace function getfunded.hash_token(token text) returns text
language sql immutable strict
set search_path = getfunded, pg_temp
as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex')
$$;

-- "Today" is always the UTC calendar day, whatever the session timezone.
create or replace function getfunded.utc_today() returns date
language sql stable
set search_path = getfunded, pg_temp
as $$
  select (now() at time zone 'UTC')::date
$$;

-- Billing period arithmetic, shared by reserve_credits() and v_usage_period.
-- The period starts on the anchor day of the current month when today is on
-- or after it, otherwise on the anchor day of the previous month. Anchor days
-- past the end of a month clamp to that month's last day (31 -> Feb 28).
-- as_of defaults to the UTC day, the same clock reserve_credits() and
-- v_usage_period use, so a session timezone can never shift the period.
create or replace function getfunded.period_start(anchor_day int, as_of date default getfunded.utc_today())
returns date
language sql immutable
set search_path = getfunded, pg_temp
as $$
  with p as (
    select greatest(1, least(coalesce(anchor_day, 1), 31)) as a,
           date_trunc('month', as_of)::date                as cur
  ),
  c as (
    select a, cur,
           least(cur + (a - 1), (cur + interval '1 month - 1 day')::date) as cur_anchor,
           (cur - interval '1 month')::date                               as prev
    from p
  )
  select case
    when as_of >= cur_anchor then cur_anchor
    else least(prev + (a - 1), cur - 1)
  end
  from c
$$;

create or replace function getfunded.period_end(anchor_day int, as_of date default getfunded.utc_today())
returns date
language sql immutable
set search_path = getfunded, pg_temp
as $$
  with p as (
    select greatest(1, least(coalesce(anchor_day, 1), 31)) as a,
           (date_trunc('month', getfunded.period_start(anchor_day, as_of)) + interval '1 month')::date as nm
  )
  select least(nm + (a - 1), (nm + interval '1 month - 1 day')::date) from p
$$;

-- ---------------------------------------------------------------------------
-- Roles and grants
-- ---------------------------------------------------------------------------
-- @roles-begin
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'getfunded_app') then
    create role getfunded_app nologin nobypassrls;
  end if;
end $$;

-- Role-level so it survives the Supabase pooler stripping startup parameters.
alter role getfunded_app set statement_timeout = '20s';

-- Let the runner `set role getfunded_app` for verification blocks and tests.
do $$
begin
  if not exists (
    select 1 from pg_auth_members am
    join pg_roles r on r.oid = am.roleid
    join pg_roles m on m.oid = am.member
    where r.rolname = 'getfunded_app' and m.rolname = current_user
  ) then
    if current_setting('server_version_num')::int >= 160000 then
      execute format('grant getfunded_app to %I with set true', current_user);
    else
      execute format('grant getfunded_app to %I', current_user);
    end if;
  end if;
end $$;

grant usage on schema getfunded to getfunded_app;

revoke all on function getfunded.current_user_id() from public;
revoke all on function getfunded.is_member(uuid) from public;
revoke all on function getfunded.is_admin(uuid) from public;
revoke all on function getfunded.is_steward() from public;
revoke all on function getfunded.set_updated_at() from public;
revoke all on function getfunded.slugify(text) from public;
revoke all on function getfunded.hash_token(text) from public;
revoke all on function getfunded.utc_today() from public;
revoke all on function getfunded.period_start(int, date) from public;
revoke all on function getfunded.period_end(int, date) from public;

grant execute on function getfunded.current_user_id() to getfunded_app;
grant execute on function getfunded.is_member(uuid) to getfunded_app;
grant execute on function getfunded.is_admin(uuid) to getfunded_app;
grant execute on function getfunded.is_steward() to getfunded_app;
grant execute on function getfunded.slugify(text) to getfunded_app;
grant execute on function getfunded.hash_token(text) to getfunded_app;
grant execute on function getfunded.utc_today() to getfunded_app;
grant execute on function getfunded.period_start(int, date) to getfunded_app;
grant execute on function getfunded.period_end(int, date) to getfunded_app;
-- @roles-end

-- Corpus plane: read and execute, nothing else. Granted by name, never through
-- default privileges, so a future internal table is invisible to the app until
-- a migration says otherwise. Guarded so a clean replay on a database without
-- the corpus (vanilla Postgres, PGlite) still succeeds.
-- @roles-begin corpus
do $$
declare
  rel record;
  fn  record;
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0001: schema internal not present; skipping corpus grants';
    return;
  end if;

  grant usage on schema internal to getfunded_app;
  grant usage on schema public   to getfunded_app;
  if to_regnamespace('extensions') is not null then
    grant usage on schema extensions to getfunded_app;   -- halfvec casts for hybrid_search
  end if;

  -- Named internal relations plus the two name patterns from ARCHITECTURE.md.
  for rel in
    select c.oid::regclass as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'internal'
      and c.relkind in ('r', 'p', 'v', 'm')
      and (c.relname in ('search_documents', 'organizations', 'filings',
                         'funding_events', 'funding_programs', 'org_website')
           or c.relname like 'filing\_%'
           or c.relname like 'mv\_%')
  loop
    execute format('grant select on %s to getfunded_app', rel.name);
  end loop;

  -- Every license-filtered public view (owner-rights views; SELECT must be on
  -- the view itself).
  for rel in
    select c.oid::regclass as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('grant select on %s to getfunded_app', rel.name);
  end loop;

  -- The two search doors, by oid so the halfvec signature never has to be
  -- spelled here.
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname in ('hybrid_search', 'similar_orgs')
  loop
    execute format('grant execute on function %s to getfunded_app', fn.sig);
  end loop;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, on the live database):
--   begin; set local role getfunded_app;
--     select 1 from internal.organizations limit 1;           -- works
--     insert into internal.org_web_facts default values;      -- MUST fail
--     create table getfunded.x (i int);                       -- MUST fail
--     select getfunded.period_start(31, date '2026-03-05');   -- 2026-02-28
--   rollback;

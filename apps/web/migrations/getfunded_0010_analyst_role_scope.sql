-- getfunded_0010: scope the analyst role to the SQL guard's allowlist, and let
-- the app role read file hashes for provenance seals.
--
-- Two grant changes on the corpus plane. Both are idempotent, both are
-- skipped on a database without the corpus (PGlite in the unit tests, a
-- vanilla Postgres before `funderdb bootstrap`), and neither touches a
-- getfunded.* object.
--
--  1. funder_ro — the role behind "Ask the analyst" (ANALYST_DATABASE_URL),
--     which runs SQL written by a language model — may SELECT exactly what
--     lib/ai/sql-guard.ts allows: the public.* views (ALLOWED_PUBLIC_VIEWS)
--     and the internal.mv_* materialized views (ALLOWED_MATVIEWS). Every
--     other internal relation (contact_channels with its internal-only
--     personal channels, raw_files, org_web_facts, filing_application_info
--     with Part XV emails and phones, ...) is revoked; the default privilege
--     that would hand the role every future internal table is removed; and
--     the role's search_path becomes `public`, so an unqualified name can
--     never resolve into internal. The guard refuses those names first; this
--     makes the database refuse them too. The two search functions
--     (internal.hybrid_search, internal.similar_orgs) read internal tables as
--     the caller and are not SECURITY DEFINER, so they stop working for
--     funder_ro: the analyst prompt no longer offers them, and the funder
--     page keeps using them through getfunded_app.
--
--  2. getfunded_app gets SELECT on two columns of internal.raw_files
--     (id, sha256), so funder pages can show the fingerprint of the file a
--     fact was parsed from. Nothing else on raw_files: dataset names and
--     source URLs stay behind the license-filtered public views. The web app
--     probes this grant once per process (lib/queries/corpus/sql-fragments.ts)
--     and leaves the hash out until it is there, so deploying the app before
--     this migration is safe.
--
-- The allowlist is spelled out here AND in lib/ai/sql-guard.ts. `npm run
-- db:ping` with ANALYST_DATABASE_URL set reads both and fails when they drift.
--
-- Operator notes:
--   - Run as the corpus owner (postgres on Supabase). ALTER DEFAULT PRIVILEGES
--     FOR ROLE <owner> and ALTER ROLE need that; each step that can lack
--     privilege raises a NOTICE and the rest still applies.
--   - funder_ro is created by the corpus (open-funder-db), not here. When it
--     is absent the role steps are skipped with a NOTICE and only the raw_files
--     column grant applies.

-- @roles-begin corpus
do $$
declare
  allowed_mv constant text[] := array[
    'mv_org_latest_financials',
    'mv_org_application_posture',
    'mv_funder_event_stats',
    'mv_recipient_event_stats',
    'mv_overview_totals',
    'mv_org_type_counts',
    'mv_org_state_counts',
    'mv_event_type_totals',
    'mv_events_by_year',
    'mv_top_funders',
    'mv_amount_histogram'
  ];
  allowed_public constant text[] := array[
    'organizations',
    'funding_events',
    'contact_channels',
    'org_application_posture',
    'org_financial_series',
    'filings',
    'filing_financials',
    'filing_application_info',
    'filing_contributors',
    'filing_officers',
    'funding_programs',
    'org_identifiers',
    'people',
    'relationships'
  ];
  rel record;
  acl record;
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0010: schema internal not present; skipping corpus grants';
    return;
  end if;

  -- 2. Provenance hashes for the app role: two columns, nothing else.
  if to_regclass('internal.raw_files') is not null then
    grant select (id, sha256) on internal.raw_files to getfunded_app;
  end if;

  -- 1. The analyst role.
  if not exists (select 1 from pg_roles where rolname = 'funder_ro') then
    raise notice 'getfunded_0010: role funder_ro not present; Ask the analyst is not configured on this database';
    return;
  end if;

  grant usage on schema internal to funder_ro;
  grant usage on schema public to funder_ro;

  -- Every internal relation: SELECT when allowlisted, nothing otherwise.
  for rel in
    select c.oid::regclass as name, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'internal'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  loop
    if rel.relkind = 'S' then
      execute format('revoke all on sequence %s from funder_ro', rel.name);
    elsif rel.relname = any(allowed_mv) then
      execute format('revoke all on %s from funder_ro', rel.name);
      execute format('grant select on %s to funder_ro', rel.name);
    else
      execute format('revoke all on %s from funder_ro', rel.name);
    end if;
  end loop;

  -- Every public relation: SELECT on the allowlisted views, nothing otherwise.
  for rel in
    select c.oid::regclass as name, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if rel.relname = any(allowed_public) then
      execute format('revoke all on %s from funder_ro', rel.name);
      execute format('grant select on %s to funder_ro', rel.name);
    else
      execute format('revoke all on %s from funder_ro', rel.name);
    end if;
  end loop;

  -- Default privileges: a future internal table must not be readable by the
  -- analyst until a migration says so.
  for acl in
    select distinct r.rolname as grantor, d.defaclobjtype as kind
    from pg_default_acl d
    join pg_roles r on r.oid = d.defaclrole
    join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'internal'
      and d.defaclobjtype in ('r', 'S', 'f')
      and exists (
        select 1 from aclexplode(d.defaclacl) a
        join pg_roles g on g.oid = a.grantee
        where g.rolname = 'funder_ro')
  loop
    begin
      execute format(
        'alter default privileges for role %I in schema internal revoke all on %s from funder_ro',
        acl.grantor,
        case acl.kind when 'r' then 'tables' when 'S' then 'sequences' else 'functions' end);
    exception when insufficient_privilege then
      raise notice 'getfunded_0010: could not alter default privileges granted by % (run as that role or a superuser)', acl.grantor;
    end;
  end loop;

  -- Role settings: bare names resolve to the public views only; read-only and
  -- bounded whatever the client forgets to set.
  begin
    alter role funder_ro set search_path = public;
    alter role funder_ro set default_transaction_read_only = on;
    alter role funder_ro set statement_timeout = '15s';
  exception when insufficient_privilege then
    raise notice 'getfunded_0010: could not alter role funder_ro settings (needs CREATEROLE or superuser); the app pins them per transaction anyway';
  end;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, on the live database, as funder_ro):
--   select count(*) from internal.mv_org_type_counts;          -- works
--   select count(*) from public.organizations;                 -- works
--   select count(*) from internal.contact_channels;            -- MUST fail (permission denied)
--   select count(*) from internal.raw_files;                   -- MUST fail
--   select count(*) from contact_channels;                     -- the PUBLIC view (search_path = public)
--   select * from internal.similar_orgs('<uuid>');             -- fails: reads internal tables as the caller
-- As getfunded_login:
--   select sha256 from internal.raw_files limit 1;             -- works
--   select source_url from internal.raw_files limit 1;         -- MUST fail (column not granted)
-- Or run `npm run db:ping` with ANALYST_DATABASE_URL set: it prints PASS when
-- funder_ro's readable relations equal the guard's allowlist exactly.

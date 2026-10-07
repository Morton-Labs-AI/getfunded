-- 0022: roles — make the schema applicable to a database that is not ours.
--
-- THE BUG THIS FIXES. Six migrations grant to funder_ro, the first at 0008.
-- No migration had created it. 0008 also does
-- `create extension vector with schema extensions` against a schema no
-- migration creates (Supabase provisions it out of band). So a fresh Postgres
-- failed at migration 8 of 21, twice:
--     ERROR: schema "extensions" does not exist
--     ERROR: role "funder_ro" does not exist
-- Until now this repo has been readable source, not runnable source: nobody
-- could fork the database and stand it up, whatever the export contained.
--
-- ORDERING NOTE. Creating the roles HERE was still too late for a linear
-- replay (0008 runs first). 0000_roles_bootstrap.sql now creates all three
-- roles ahead of every grant; the CREATE ROLE block below is kept, byte for
-- byte in effect, so that a database which already applied 0022 by hand and
-- never ran 0000 still converges. Every statement in this file is a no-op
-- when its object already exists — that is what makes both orders safe.
--
-- Idempotent by construction — against the live project every statement here
-- is a no-op, so applying it changes nothing and proves the gap is closed.
--
-- RECONCILE BEFORE APPLYING. funder_ro in production already reads tables that
-- no migration grants (licensing_map, organizations, funding_events, filings,
-- raw_files among them), so production's grants were made by hand. Compare
-- with `\dp internal.*` first. If production is NARROWER than this file,
-- applying it is a privilege expansion, not a no-op — read it as such.
--
-- NO LOGIN, NO PASSWORD, EVER. These roles are grant containers. Attaching a
-- password is an operator step, out of band, never in a file that ships public.

-- ---------------------------------------------------------------------------
-- Schemas assumed by later migrations.
-- ---------------------------------------------------------------------------
-- 0008:21 installs pgvector here. On Supabase this schema already exists; on
-- vanilla Postgres it does not, and 0008 dies. Creating it in 0022 is too late
-- for a linear replay, so this line ALSO belongs at the top of 0001 — it is
-- repeated here so that an existing database picks it up without rewriting a
-- migration that has already been applied.
create schema if not exists extensions;

-- ---------------------------------------------------------------------------
-- Roles.
-- ---------------------------------------------------------------------------
do $$
begin
  -- The application's read identity. Read-only is enforced by the role, not by
  -- the connection string, so it survives the Supabase pooler stripping
  -- startup parameters.
  if not exists (select 1 from pg_roles where rolname = 'funder_ro') then
    create role funder_ro nologin;
  end if;

  -- The admin write identity. Replaces the Supabase superuser in
  -- ADMIN_DATABASE_URL: the labeling and enrichment flows write five tables
  -- and need no DDL whatsoever, but held rights over all 27.8GB.
  if not exists (select 1 from pg_roles where rolname = 'funder_rw') then
    create role funder_rw nologin;
  end if;

  -- The owner the public.* views will be re-owned to in a later migration.
  -- Created here so the role exists before anything references it.
  -- NOBYPASSRLS is belt-and-braces: this role must never be able to read past
  -- a policy, whatever it is later granted.
  if not exists (select 1 from pg_roles where rolname = 'ofdb_publisher') then
    create role ofdb_publisher nologin nobypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- funder_ro: read-only, and bounded.
-- ---------------------------------------------------------------------------
alter role funder_ro set default_transaction_read_only = on;

-- 15s matches the UI pool's statement_timeout (lib/db.ts). It is a deliberate
-- guard against one bad model-generated query over 14.5M funding_events
-- holding a connection out of a six-connection pool. Do not raise it; if a
-- legitimate query needs longer it belongs in a materialized view, which is
-- the pattern 0007/0016/0018 already establish.
alter role funder_ro set statement_timeout = '15s';

grant usage on schema internal to funder_ro;
grant select on all tables in schema internal to funder_ro;
grant execute on all functions in schema internal to funder_ro;

-- `grant ... on all tables` is a SNAPSHOT, not a rule — which is exactly why
-- 0018:189 and 0020:176 had to hand-grant their new objects. This is the rule.
-- It applies only to objects created by the role that runs it, so it must run
-- as the migration role (postgres) or it silently does nothing.
alter default privileges in schema internal
  grant select on tables to funder_ro;
alter default privileges in schema internal
  grant execute on functions to funder_ro;

-- ---------------------------------------------------------------------------
-- funder_rw: write exactly what the admin surface writes, and nothing else.
--
-- Deliberately absent: any DDL, any DROP, any TRUNCATE, and any write to the
-- fact tables (organizations, funding_events, filings, filing_*). Those belong
-- to the pipeline, which connects as the owner. An admin UI that can rewrite
-- filings is a blast radius with no upside.
-- ---------------------------------------------------------------------------
grant usage on schema internal to funder_rw;
grant select on all tables in schema internal to funder_rw;
alter default privileges in schema internal
  grant select on tables to funder_rw;

grant insert, update on
  internal.er_labels,
  internal.entity_links,
  internal.org_web_facts,
  internal.raw_files,
  internal.ingestion_ledger
  to funder_rw;

-- DELETE only where a flow genuinely needs it: undoDecision removes a label
-- the operator just recorded (lib/admin/labeling.ts). Nothing else may delete.
grant delete on internal.er_labels to funder_rw;

grant usage, select on all sequences in schema internal to funder_rw;
alter default privileges in schema internal
  grant usage, select on sequences to funder_rw;

-- ---------------------------------------------------------------------------
-- Verification (run by hand; each must hold before this migration is trusted).
-- ---------------------------------------------------------------------------
-- Read path intact, and still read-only:
--   begin; set local role funder_ro;
--     select count(*) from internal.organizations;              -- nonzero
--     select count(*) from internal.mv_org_application_posture;  -- nonzero
--     create table internal.x (i int);                           -- MUST fail
--   rollback;
--
-- Write path bounded:
--   begin; set local role funder_rw;
--     select count(*) from internal.er_labels;                   -- nonzero
--     create table internal.x (i int);                           -- MUST fail
--     delete from internal.organizations;                        -- MUST fail
--   rollback;

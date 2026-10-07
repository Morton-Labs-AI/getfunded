-- community_0001: the community schema and the community_app role.
--
-- The community schema is the Greenbook membership layer, colocated with the
-- open-funder-db corpus so that saved lists, follows, notes and tags can JOIN
-- corpus tables in single SQL statements. The corpus stays read-only to this
-- application FOREVER — enforced here by the ABSENCE of write grants on
-- internal.*, which is stronger than default_transaction_read_only
-- (community_app must write community.*, so a transaction-level read-only
-- setting is not available to it). This is dnw_0001's doctrine, verbatim.
--
-- WHY A NEW SCHEMA AND NOT internal.*:
--   0022_roles.sql set `alter default privileges in schema internal grant
--   select on tables to funder_ro, funder_rw, dnw_app`. Every new internal
--   table is therefore BORN with table-level SELECT to funder_ro — and
--   funder_ro is the pool that executes MODEL-GENERATED SQL (lib/ai/tools.ts
--   runs tx.unsafe(<model output>); lib/ai/sql-guard.ts allows any `select`
--   with no schema restriction). A members table in internal would be one
--   model turn from `select email from internal.members` in the chat pane.
--   A fresh schema has no default ACL: the default is deny.
--
--   Second reason: the corpus invariant is that every fact row carries
--   raw_file_id + source_record_locator. A saved list has no source file and
--   never will. Putting membership in internal makes that invariant false and
--   forces a carve-out list into every future export assertion.
--
-- WHY NOT DNW'S ONE-POOL ANSWER: DNW collapses to a single role because every
-- statement on its pool is hand-written. Greenbook cannot — see above. Two
-- pools, split by WHO AUTHORED THE SQL: funder_ro is the analyst pool
-- (model-generated, no privileges here at all), community_app is the
-- application pool (hand-written only).
--
-- NO LOGIN, NO PASSWORD, EVER (0022 doctrine). community_app is a grant
-- container; attaching login is an operator step, out of band, never here.

create schema if not exists community;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'community_app') then
    -- NOBYPASSRLS: community_0005 puts RLS on every table in this schema and
    -- this role must be subject to it. postgres owns the tables and is
    -- rolbypassrls, so policies guard the app, not the operator.
    create role community_app nologin nobypassrls;
  end if;
end $$;

-- 15s is corpus doctrine (0022): anything slower belongs in a materialized
-- view. Role-level so it survives the Supabase pooler stripping startup
-- parameters.
alter role community_app set statement_timeout = '15s';

-- internal FIRST, mirroring funder_ro's role-level search_path, so any query
-- text shared with the analyst prompt resolves identically. Every shipped
-- query is schema-qualified anyway; this is belt-and-braces.
alter role community_app set search_path = 'internal, community, public';

-- REQUIRED, or every `set local role community_app` verification block in
-- every community migration is dead text. postgres holds ADMIN on
-- funder_ro/funder_rw/ofdb_publisher but NOT SET (pg_auth_members.set_option
-- = false), which is why `set role funder_ro` fails today; postgres->dnw_app
-- carries set_option = true, which is why DNW's blocks run. Mirror DNW.
-- (WITH SET requires PostgreSQL 16+. Verified: this cluster exposes
-- pg_auth_members.set_option, which is a 16+ column.)
grant community_app to postgres with set true;

-- ---------------------------------------------------------------------------
-- Corpus: read + execute, nothing else. This is the load-bearing property.
-- ---------------------------------------------------------------------------
grant usage on schema internal to community_app;
grant select on all tables in schema internal to community_app;
grant execute on all functions in schema internal to community_app;

-- pgvector lives in the extensions schema; hybrid_search callers cast query
-- embeddings to extensions.halfvec(512).
grant usage on schema extensions to community_app;

-- DELIBERATELY ABSENT: `alter default privileges in schema internal ... to
-- community_app`. `grant ... on all tables` is a SNAPSHOT, not a rule (0022's
-- own words), and here that is the FEATURE: a future internal table is not
-- readable by the community role until a migration says so by name. The
-- default-privilege rule is exactly the hazard this schema exists to avoid.
-- Do not add community_app to it.

-- public.* is likewise absent. This app reads internal.* directly (every
-- lib/queries module is schema-qualified to internal); the license-filtered
-- public views are the anonymous PostgREST surface and are not our read path.

-- ---------------------------------------------------------------------------
-- Column withholdings on the corpus.
--
-- THE GOTCHA, stated once because it silently defeats the obvious spelling:
-- a table-level GRANT SELECT implies SELECT on EVERY column, including columns
-- added later. `revoke select (col) on tbl from role` against a table-level
-- grant is a NO-OP — Postgres accepts the statement, may warn, and
-- has_column_privilege() still returns TRUE. The only correct sequence is
-- revoke the TABLE grant, then grant the enumerated column list.
-- Assert with has_column_privilege(), never by reading \dp.
-- ---------------------------------------------------------------------------
revoke select on internal.org_web_facts from community_app;
grant select (id, org_id, website_url, focus_areas, giving_priorities,
              application_info, application_url, accepts_unsolicited,
              geographic_focus, people, extracted_summary, extraction_model,
              extraction_confidence, extracted_at, status, reviewed_by,
              reviewed_at, created_by, notes, raw_file_id,
              source_record_locator, created_at, updated_at)
  on internal.org_web_facts to community_app;
-- raw_source is ABSENT: it holds verbatim publisher-website excerpts under
-- license publisher_website (republishable = false, 0012). A community page
-- rendering "the current confirmed facts, so you can suggest a correction"
-- must not be able to render the publisher's prose.

revoke select on internal.raw_files from community_app;
grant select (id, dataset_name, source_url, license_code, as_of_date,
              downloaded_at, content_type, byte_size)
  on internal.raw_files to community_app;
-- storage_path, sha256 and meta are ABSENT (the 07-plan's X15 withholding,
-- applied here to the one role new enough to get it right from the start).

-- ---------------------------------------------------------------------------
-- Workspace: full DML by default. Append-only tables and decision columns are
-- tightened per-table in the migration that creates them — column-level
-- grants, not app discipline.
-- ---------------------------------------------------------------------------
grant usage on schema community to community_app;
grant select, insert, update, delete on all tables in schema community to community_app;
grant usage, select on all sequences in schema community to community_app;
alter default privileges in schema community
  grant select, insert, update, delete on tables to community_app;
alter default privileges in schema community
  grant usage, select on sequences to community_app;
alter default privileges in schema community
  grant execute on functions to community_app;

-- ---------------------------------------------------------------------------
-- The maintainer foothold.
--
-- The accept path (community_0006) must flip a suggestion AND write
-- internal.org_web_facts in ONE transaction, so one role must hold both. That
-- role is funder_rw — already the corpus write identity, already localhost-
-- gated by lib/admin/guard.ts — NOT community_app, which must never gain a
-- write grant on internal. Trust flows maintainer -> community, never
-- community -> corpus.
--
-- Table-level grants for funder_rw are issued per-table, by name, in the
-- migrations that create them. Nothing is granted wholesale here.
-- ---------------------------------------------------------------------------
grant usage on schema community to funder_rw;

-- funder_ro is granted NOTHING in this schema — not even USAGE. That single
-- omission is what makes the analyst's blast radius provably the corpus.

-- ---------------------------------------------------------------------------
-- Shared helpers. Own copies — community must not depend on internal's
-- helpers surviving a corpus refactor (dnw_0001 doctrine).
-- ---------------------------------------------------------------------------

-- search_path = '' + fully pg_catalog-qualified: the 0006 hardening shape.
create or replace function community.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end $$;

-- Handle/slug normaliser. immutable + parallel safe so it can back a generated
-- column and a unique index (internal.norm_name, 0009, is the shape).
create or replace function community.norm_slug(s text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select nullif(
    pg_catalog.btrim(
      pg_catalog.regexp_replace(
        pg_catalog.lower(coalesce(s, '')),
        '[^a-z0-9]+', '-', 'g'),
      '-'),
    '')
$$;

-- ---------------------------------------------------------------------------
-- Verification (run by hand; each must hold before this migration is trusted).
-- ---------------------------------------------------------------------------
--   begin; set local role community_app;
--     select count(*) from internal.organizations;                 -- nonzero
--     select id, website_url from internal.org_web_facts limit 1;   -- ok
--     select raw_source from internal.org_web_facts limit 1;        -- MUST fail
--     select storage_path from internal.raw_files limit 1;          -- MUST fail
--     insert into internal.er_labels (job, label)
--       values ('probe', 'match');                                  -- MUST fail
--     create table community.x (i int);                             -- MUST fail (no CREATE)
--   rollback;
--
--   select has_schema_privilege('funder_ro',     'community', 'usage');  -- false
--   select has_schema_privilege('anon',          'community', 'usage');  -- false
--   select has_schema_privilege('authenticated', 'community', 'usage');  -- false
--   select has_schema_privilege('dnw_app',       'community', 'usage');  -- false
--   select has_column_privilege('community_app', 'internal.org_web_facts',
--                               'raw_source', 'select');                 -- false
--   select has_column_privilege('community_app', 'internal.raw_files',
--                               'storage_path', 'select');               -- false

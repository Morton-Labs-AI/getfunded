-- 0036: greenbook_ro — the read identity for Greenbook (apps/greenbook).
--
-- WHY. 0022 made funder_ro the read role for every app, with SELECT on all
-- of internal. The web app's migration getfunded_0010 (2026-10-08) then cut
-- funder_ro down to the analyst's allowlist (the public.* views and the
-- internal.mv_* materialized views), because funder_ro runs SQL written by a
-- language model and must not see personal contact channels, raw_files or
-- org_web_facts. That was right for the analyst and wrong for Greenbook,
-- whose hand-written pages read ~30 internal relations (organizations,
-- people, er_labels, entity_links, contact_channels with the tiering done in
-- SQL, raw_files for the Provenance Seal, ...). Every Greenbook page that
-- reads one of them has failed with "permission denied" since. This file
-- gives Greenbook its own read role with the shape funder_ro had before
-- getfunded_0010, and keeps funder_ro scoped for the analyst.
--
-- NO LOGIN, NO PASSWORD, EVER (0000 doctrine). The operator creates the login
-- out of band:
--   create role greenbook_login login password '<choose>' in role greenbook_ro;
-- and puts that login in apps/greenbook/.env.local as DATABASE_URL.
--
-- Read-only is enforced by the role, not by the connection string, so it
-- survives the pooler stripping startup parameters (same reasoning as 0022).
-- Nothing here touches getfunded.*, dnw.* or community.*: this role reads the
-- corpus plane and nothing else. Idempotent by construction.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'greenbook_ro') then
    create role greenbook_ro nologin nobypassrls;
  end if;
end $$;

alter role greenbook_ro set default_transaction_read_only = on;
-- 15s matches the Greenbook pool's statement_timeout (apps/greenbook/lib/db.ts)
-- and funder_ro's (0022). Slower queries belong in a materialized view.
alter role greenbook_ro set statement_timeout = '15s';

grant usage on schema internal to greenbook_ro;
grant usage on schema public to greenbook_ro;
grant usage on schema extensions to greenbook_ro;

grant select on all tables in schema internal to greenbook_ro;
grant execute on all functions in schema internal to greenbook_ro;
grant select on all tables in schema public to greenbook_ro;

-- The rule, not the snapshot (0022's lesson): objects the owner creates later
-- in internal are readable by Greenbook without a hand grant.
alter default privileges in schema internal
  grant select on tables to greenbook_ro;
alter default privileges in schema internal
  grant execute on functions to greenbook_ro;
alter default privileges in schema public
  grant select on tables to greenbook_ro;

-- ---------------------------------------------------------------------------
-- Verification (run by hand as the owner; each must hold).
-- ---------------------------------------------------------------------------
--   begin; set local role greenbook_ro;
--     select count(*) from internal.er_labels;                  -- no error
--     select count(*) from internal.organizations;              -- nonzero
--     select count(*) from internal.mv_org_application_posture; -- nonzero
--     create table internal.x (id int);                         -- ERROR: read-only transaction
--     select count(*) from getfunded.workspaces;                -- ERROR: permission denied
--   rollback;
--   select rolname from pg_roles where rolname = 'greenbook_ro' and rolcanlogin; -- zero rows

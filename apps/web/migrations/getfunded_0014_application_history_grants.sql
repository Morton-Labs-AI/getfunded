-- getfunded_0014: let the app role read the application history and the
-- recipient turnover counts.
--
-- Corpus migration 0029 (corpus/migrations/0029_application_history.sql) adds
-- two internal objects:
--
--   internal.mv_org_posture_history     one row per foundation: how many of
--                                       its Form 990-PF returns gave each
--                                       application answer, and the most
--                                       recent return with the other answer
--   internal.funder_recipient_turnover  per foundation and fiscal year: how
--                                       many named grant recipients were on
--                                       none of its lists for the three years
--                                       before (filled by `funderdb derive
--                                       turnover`)
--
-- The funder page reads both (lib/queries/corpus/application-history.ts). The
-- `mv\_%` name pattern in getfunded_0001 was applied once, when 0001 ran, so
-- it does not cover a materialized view created afterwards. The grant has to
-- be made here.
--
-- Both are counts from past returns. Neither is a public.* view yet, on
-- purpose (see the header of corpus 0029): they must not be read without the
-- note that sits beside them on the page.
--
-- This file holds grants on corpus objects only: one `-- @roles-begin corpus`
-- block, stripped in the PGlite unit tests. It is idempotent.
--
-- ORDER. Apply corpus migration 0029 first (`cd corpus && uv run funderdb
-- migrate`). On a database that has the corpus schema but not 0029, this file
-- STOPS with an error and records nothing, so the next run applies it. It does
-- not skip quietly: the runner never re-applies a file whose text did not
-- change, so a quiet skip would leave the grants missing for good. On a
-- database with no corpus at all (no `internal` schema) it does nothing.
-- The web app is safe in either order: it checks for the two relations and
-- shows nothing until it can read them.
--
-- funder_ro (Ask the analyst) gets nothing here: neither relation is on the
-- SQL guard's allowlist, and corpus 0029 revokes the role on both.

-- @roles-begin corpus
do $$
declare
  rel text;
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0014: schema internal not present; skipping corpus grants';
    return;
  end if;
  foreach rel in array array[
    'internal.mv_org_posture_history',
    'internal.funder_recipient_turnover'
  ]
  loop
    if to_regclass(rel) is null then
      raise exception 'getfunded_0014: % is not there. Apply corpus migration 0029 first (cd corpus && uv run funderdb migrate), then run db:migrate again.', rel;
    end if;
    execute format('grant select on %s to getfunded_app', rel);
  end loop;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, as getfunded_login):
--   select n_returns from internal.mv_org_posture_history limit 1;      -- works
--   select n_new from internal.funder_recipient_turnover limit 1;       -- works (no rows before the first derive run)
--   delete from internal.funder_recipient_turnover;                     -- MUST fail
-- As funder_ro:
--   select count(*) from internal.mv_org_posture_history;               -- MUST fail
--
-- Undo:
--   revoke select on internal.mv_org_posture_history,
--     internal.funder_recipient_turnover from getfunded_app;
--   delete from getfunded.schema_migrations
--    where filename = 'getfunded_0014_application_history_grants.sql';
-- ---------------------------------------------------------------------------

-- getfunded_0015: let the app role read funder signals.
--
-- Corpus migration 0035 (corpus/migrations/0035_funder_signals.sql) adds:
--
--   internal.funder_signals      one row per dated, sourced funder announcement
--                                (a press release, a program launch, an open
--                                call), classified into a fixed vocabulary
--   internal.funder_signal_orgs  which organizations each signal is about
--   internal.signal_sources      the watch list the pipeline polls
--
-- The funder page shows published signals (lib/queries/corpus/signals.ts),
-- and the door getfunded.sync_signal_notifications() (getfunded_0016) turns
-- new published signals into notifications for the people they concern. Both
-- read status = 'published' rows only; the app never sees a candidate.
--
-- This file holds grants on corpus objects only: one `-- @roles-begin corpus`
-- block, stripped in the PGlite unit tests. It is idempotent.
--
-- ORDER. Apply corpus migration 0035 first (`cd corpus && uv run funderdb
-- migrate`). On a database that has the corpus schema but not 0035 this file
-- STOPS with an error and records nothing, so the next run applies it. On a
-- database with no corpus at all (no `internal` schema) it does nothing. The
-- web app probes the grant and shows nothing until it is there.
--
-- funder_ro (Ask the analyst) gets nothing here: the analyst reads the
-- public.funder_signals view, which corpus 0035 grants it directly, and the
-- SQL guard's allowlist decides whether that view is reachable.

-- @roles-begin corpus
do $$
declare
  rel text;
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0015: schema internal not present; skipping corpus grants';
    return;
  end if;
  foreach rel in array array[
    'internal.funder_signals',
    'internal.funder_signal_orgs',
    'internal.signal_sources'
  ]
  loop
    if to_regclass(rel) is null then
      raise exception 'getfunded_0015: % is not there. Apply corpus migration 0035 first (cd corpus && uv run funderdb migrate), then run db:migrate again.', rel;
    end if;
    execute format('grant select on %s to getfunded_app', rel);
  end loop;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, as getfunded_login):
--   select count(*) from internal.funder_signals where status = 'published'; -- works
--   update internal.funder_signals set status = 'published';                 -- MUST fail
--
-- Undo:
--   revoke select on internal.funder_signals, internal.funder_signal_orgs,
--     internal.signal_sources from getfunded_app;
--   delete from getfunded.schema_migrations
--    where filename = 'getfunded_0015_signal_grants.sql';
-- ---------------------------------------------------------------------------

-- getfunded_0017: let the app role read the public funder-signals view.
--
-- WHY. The funder page's Signals section (lib/queries/corpus/signals.ts)
-- needs each published signal's dataset name and licence, and must show only
-- signals whose compilation file is republishable. Before this file the
-- reader joined internal.raw_files (dataset_name, license_code) and
-- internal.licensing_map itself. The app role holds neither: getfunded_0010
-- grants it exactly (id, sha256) on internal.raw_files, on purpose, and
-- nothing on licensing_map. So every funder page raised "permission denied
-- for table raw_files" (about 250,000 errors a day in October 2026) and the
-- Signals section was always empty.
--
-- THE FIX, least privilege. Corpus migration 0035 already publishes
-- public.funder_signals: published rows only, licence-filtered, facts only
-- (no raw_source, no notes, no snapshot), with source_dataset and
-- license_name. That view is the intended public read surface; Supabase
-- already lets `anon` read it. The app role gets SELECT on that one view and
-- nothing else. raw_files and licensing_map stay closed to it.
--
-- Not granted: public.funder_signal_orgs. The reader joins the org links
-- through internal.funder_signal_orgs (getfunded_0015, indexed on org_id),
-- and the inner join to the view drops links to unpublished signals.
--
-- This file holds grants on corpus objects only: one `-- @roles-begin corpus`
-- block, stripped in the PGlite schema tests (tests/unit/db/signal-grants.test.ts
-- runs it against a stand-in corpus instead). It is idempotent.
--
-- ORDER. Corpus migration 0035 must be applied first (it is, on the hosted
-- corpus). On a database with the corpus schema but without the view this
-- file STOPS with an error and records nothing. On a database with no corpus
-- at all (no `internal` schema) it does nothing. The web app probes the grant
-- and shows no signals, and raises nothing, until it is there.

-- @roles-begin corpus
do $$
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0017: schema internal not present; skipping corpus grants';
    return;
  end if;
  if to_regclass('public.funder_signals') is null then
    raise exception 'getfunded_0017: public.funder_signals is not there. Apply corpus migration 0035 first (cd corpus && uv run funderdb migrate), then run db:migrate again.';
  end if;
  grant select on public.funder_signals to getfunded_app;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, as getfunded_login):
--   select count(*) from public.funder_signals;                  -- works
--   select dataset_name from internal.raw_files limit 1;         -- MUST still fail
--   select count(*) from internal.licensing_map;                 -- MUST still fail
--
-- Undo:
--   revoke select on public.funder_signals from getfunded_app;
--   delete from getfunded.schema_migrations
--    where filename = 'getfunded_0017_signal_view_grant.sql';
-- ---------------------------------------------------------------------------

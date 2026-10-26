-- getfunded_0018: let the app and the analyst read the funder giving profiles.
--
-- Corpus migration 0040 (getfunded-ai/open-nonprofit-platform
-- corpus/migrations/0040_funder_giving_profiles.sql) adds three materialized
-- views over the live, republishable grant rows:
--
--   internal.mv_funder_giving_state   funder x recipient state
--   internal.mv_funder_giving_cause   funder x NTEE major group of the recipient
--   internal.mv_funder_grant_profile  the shape of a funder's last five fiscal years
--
-- Funder search reads them to rank and explain results ("14 grants in Ohio,
-- FY2021-2025"); the analyst may read them too, so "who funds education in
-- Ohio" is an index lookup instead of a scan of 18M grant rows. The SQL
-- guard's allowlist (lib/ai/sql-guard.ts) names the same three views, so the
-- analyst's readable relations still equal the allowlist (`npm run db:ping`).
--
-- Read only, three relations, nothing else.
--
-- Corpus grants only, so the whole file is one `-- @roles-begin corpus` block,
-- which the PGlite harness strips. On a database with no corpus at all (no
-- schema `internal`) the block is skipped with a NOTICE, so a clean replay on
-- vanilla Postgres still succeeds.
--
-- Order on a real database: corpus 0040 FIRST (`uv run funderdb migrate` in
-- the corpus), then this file. On a database that has the corpus but not 0040
-- this file stops with an error and records nothing. The views are created
-- empty; the app probes that they are readable AND populated
-- (lib/queries/corpus/giving-profile.ts) and ranks without them until
-- `funderdb refresh-views` has filled them, so deploy order does not matter.

-- @roles-begin corpus
do $$
declare
  rels constant text[] := array[
    'internal.mv_funder_giving_state',
    'internal.mv_funder_giving_cause',
    'internal.mv_funder_grant_profile'
  ];
  rel text;
  missing text[] := '{}';
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0018: schema internal not present; skipping corpus grants';
    return;
  end if;
  foreach rel in array rels loop
    if to_regclass(rel) is null then
      missing := missing || rel;
    end if;
  end loop;
  if array_length(missing, 1) is not null then
    raise exception 'getfunded_0018: % not present. Apply corpus migration 0040 first (`uv run funderdb migrate` in corpus/), then run this migration again.', array_to_string(missing, ', ');
  end if;
  foreach rel in array rels loop
    execute format('grant select on %s to getfunded_app', rel);
    execute format('grant select on %s to funder_ro', rel);
  end loop;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, on the live database):
--   select has_table_privilege('getfunded_app', 'internal.mv_funder_giving_state', 'select');  -- true
--   select has_table_privilege('funder_ro', 'internal.mv_funder_grant_profile', 'select');     -- true
--   select has_table_privilege('getfunded_app', 'internal.mv_funder_giving_state', 'insert');  -- false
--
-- Undo (by hand, as the owner):
--   revoke select on internal.mv_funder_giving_state, internal.mv_funder_giving_cause,
--     internal.mv_funder_grant_profile from getfunded_app, funder_ro;
--   delete from getfunded.schema_migrations where filename = 'getfunded_0018_giving_profile_grants.sql';
-- ---------------------------------------------------------------------------

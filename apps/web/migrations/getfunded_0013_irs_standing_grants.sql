-- getfunded_0013: let the app role read IRS standing.
--
-- Corpus migration 0028 (corpus/migrations/0028_irs_standing.sql) adds two
-- IRS lists and the view that says whether the IRS still lists an
-- organization:
--
--   internal.irs_revocations        the IRS Automatic Revocation of Exemption List
--   internal.irs_pub78              IRS Publication 78 data (deductibility codes)
--   internal.irs_standing_vintage   one row: the date of each list, NULL until loaded
--   internal.org_irs_standing       one row per foundation or charity EIN: standing,
--                                   the dates, and the file the answer came from
--
-- The funder page reads internal.org_irs_standing (lib/queries/corpus/standing.ts).
-- That view runs with its owner's rights, so the dataset name, URL and licence
-- of the deciding file reach the page through the view while the app role
-- still holds only (id, sha256) on internal.raw_files.
--
-- This file holds grants on corpus objects only: one `-- @roles-begin corpus`
-- block, stripped in the PGlite unit tests. It is idempotent.
--
-- ORDER. Apply corpus migration 0028 first (`cd corpus && uv run funderdb
-- migrate`). On a database that has the corpus schema but not 0028, this file
-- STOPS with an error and records nothing, so the next run applies it. It does
-- not skip quietly: the runner never re-applies a file whose text did not
-- change, so a quiet skip would leave the grants missing for good. On a
-- database with no corpus at all (no `internal` schema) it does nothing.
-- The web app is safe in either order: it probes the grant once per process
-- and shows no standing until the grant is there.
--
-- funder_ro (Ask the analyst) gets nothing here: none of these relations is
-- on the SQL guard's allowlist.

-- @roles-begin corpus
do $$
declare
  rel text;
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0013: schema internal not present; skipping corpus grants';
    return;
  end if;
  foreach rel in array array[
    'internal.irs_revocations',
    'internal.irs_pub78',
    'internal.irs_standing_vintage',
    'internal.org_irs_standing'
  ]
  loop
    if to_regclass(rel) is null then
      raise exception 'getfunded_0013: % is not there. Apply corpus migration 0028 first (cd corpus && uv run funderdb migrate), then run db:migrate again.', rel;
    end if;
    execute format('grant select on %s to getfunded_app', rel);
  end loop;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, as getfunded_login):
--   select standing from internal.org_irs_standing limit 1;        -- works
--   select * from internal.irs_standing_vintage;                   -- one row
--   select source_url from internal.raw_files limit 1;             -- MUST still fail
--   insert into internal.irs_pub78 values ('000000000','{PC}',1,'x');  -- MUST fail
--
-- Undo:
--   revoke select on internal.irs_revocations, internal.irs_pub78,
--     internal.irs_standing_vintage, internal.org_irs_standing from getfunded_app;
--   delete from getfunded.schema_migrations
--    where filename = 'getfunded_0013_irs_standing_grants.sql';
-- ---------------------------------------------------------------------------

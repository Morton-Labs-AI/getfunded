-- 0030: city, state and zip as stated on the latest return.
--
-- Why. An organisation that is created from an e-filed return and is not in
-- the IRS master file has no address on its row: the return loader writes the
-- name and nothing else. Measured on the live database on 2026-10-08, read
-- only, while a back-year load was adding more: about 24,000 private
-- foundations and 28,000 public charities have `state is null`. Search
-- filters by organizations.state, so none of them can
-- be found by state, and the Open Foundation List shows them with no city or
-- state. But every return carries the filer's own address in its header, and
-- the detail pass already stores it on internal.filings (filer_addr_line1,
-- filer_addr_line2, filer_city, filer_state, filer_zip, filer_country).
--
-- What this file adds. Two columns that say where an address came from, and
-- nothing else. No address is written here. `funderdb derive org-address
-- --apply` writes city, state and zip from the newest parsed, non-superseded
-- return, only where state, city, street and zip are all empty, and sets the
-- two columns. `--unapply` puts those rows back.
--
-- NO STREET. The job writes no street for these rows. The street line of a
-- return can name a person ("C/O <name> ...") or be a trustee's home, and an
-- organisation's street address from a return is not copied to its profile.
-- The filed line stays on the return itself (address_object_id names it).
--
--   address_basis      NULL             the address came with the row's own
--                                       source record (the IRS master file,
--                                       an SEC filing, a seed row), as before
--                      'filing_header'  city, state and zip are the filer's
--                                       on one return; street is empty
--   address_object_id  the IRS OBJECT_ID of that return (internal.filings).
--                      Its row there carries the raw file, so the address
--                      has the same provenance chain as any filing fact.
--
-- The organisation's own raw_file_id and source_record_locator do not change.
--
-- Locks. `alter table ... add column` needs a brief ACCESS EXCLUSIVE lock on
-- internal.organizations, and `create or replace view` needs one on
-- public.organizations. A load that is writing organisations, or a long read
-- of the view, holds a conflicting lock. This file never waits (the reason is
-- in 0027): if a lock is not free within half a second, which is shorter than
-- the 1 s deadlock timer, the whole file fails, nothing is applied, and
-- `funderdb migrate` is run again later.
--
-- WHEN TO RUN IT. After the loader has stopped, not between its batches. A
-- return loader holds row locks on internal.organizations for the whole of a
-- batch (measured 2026-10-08: one open transaction of 400 seconds), so this
-- file cannot get its lock while a batch runs. Every failed try also makes
-- new reads of internal.organizations (every page of the site) wait behind
-- it for up to half a second. So: stop the loader, run `funderdb migrate`
-- once, start the loader again if it has more to do. Do not put `migrate` in
-- a retry loop. 0031 is different: it can run beside a loader.
set local lock_timeout = '500ms';

-- No default and no NOT NULL, so this is a catalog change only: no row is
-- rewritten and no row is read.
alter table internal.organizations
  add column address_basis     text,
  add column address_object_id text;

-- NOT VALID on purpose. A plain CHECK makes Postgres read the whole table to
-- prove that the old rows pass, and it does that while it still holds the
-- ACCESS EXCLUSIVE lock: every read and write of internal.organizations (925
-- MB, 2.26 million rows) would wait for the scan. NOT VALID skips only that
-- scan. The rule is enforced for every insert and update from this moment,
-- and every old row holds NULL in both columns, so it passes. 0031 validates
-- the two constraints under a lock that blocks nobody.
alter table internal.organizations
  add constraint ck_orgs_address_basis
    check (address_basis in ('filing_header')) not valid,
  -- A basis always names its return, and a return id is never kept alone.
  add constraint ck_orgs_address_pair
    check ((address_basis is null) = (address_object_id is null)) not valid;

comment on column internal.organizations.address_basis is
  'Where the address came from. NULL: with the row''s own source record (the IRS master file for foundations and charities). ''filing_header'': city, state and zip are the filer''s on the return named in address_object_id, written by `funderdb derive org-address`; no street is copied from a return.';
comment on column internal.organizations.address_object_id is
  'IRS OBJECT_ID of the return (internal.filings.object_id) that city, state and zip were taken from. Set exactly when address_basis is not NULL.';

-- ---------------------------------------------------------------------------
-- The label must stay true. Other loaders overwrite an organisation's
-- address: `funderdb ingest bmf` sets street, city, state and zip (and
-- raw_file_id) for every EIN in the master file, and it knows nothing about
-- these two columns. Without a guard, an organisation that appears in the
-- master file later would keep address_basis = 'filing_header' beside an
-- address that is now the master file's.
--
-- So: when a statement SETS street, city, state or zip of a row whose
-- address_basis is set, and does not itself change the basis or the return
-- id, both go back to NULL ("the address came with the row's own source
-- record"). The derive job is not affected: its --apply starts from a NULL
-- basis, and its --unapply clears the basis in the same statement.
--
-- The new values are NOT compared with the old ones, on purpose. The master
-- file often gives the same city, state and zip as the return (measured
-- 2026-10-08 on 3,926 foundations and charities: equal in all four columns
-- for 5%). The row's raw_file_id is then the master file's, so the address
-- is the master file's too, and the label must go. If it stayed,
-- `--unapply` would empty an address that the master file wrote. With this
-- rule a row carries the basis only while the derive job is the last writer
-- of its address, so `--unapply` clears what `--apply` wrote and no more.
--
-- Cost. `update of street, city, state, zip` means the trigger is looked at
-- only for statements that name one of those columns (the master-file load,
-- the SEC adviser load, the seed), and the WHEN clause means the function
-- runs only for a row that has a basis. For every other update of this busy
-- table nothing runs.
-- ---------------------------------------------------------------------------
create function internal.tg_org_address_basis_release() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.address_basis := null;
  new.address_object_id := null;
  return new;
end $$;

comment on function internal.tg_org_address_basis_release() is
  'Clears address_basis and address_object_id when another writer sets the address of a row whose address came from a return, also when it writes the same values.';

create trigger trg_orgs_address_basis_release
  before update of street, city, state, zip on internal.organizations
  for each row
  when (old.address_basis is not null
        and new.address_basis is not distinct from old.address_basis
        and new.address_object_id is not distinct from old.address_object_id)
  execute function internal.tg_org_address_basis_release();

-- ---------------------------------------------------------------------------
-- public.organizations gains the two columns, at the end. `create or replace
-- view` may only append: the first 33 columns below are 0003's, same names,
-- same order, same types (checked against the live view on 2026-10-08). The
-- view keeps its owner and its grants, so every role that could read it can
-- read it now. No view depends on it.
--
-- Both columns are publishable: the city, state and zip are the filer's own,
-- on a public return (us_public_domain), and the OBJECT_ID is already on
-- public.filings. The Open Foundation List reads address_basis from here.
-- `o.street` is empty on every row that carries the basis.
-- ---------------------------------------------------------------------------
create or replace view public.organizations as
  select o.id, o.name, o.legal_name, o.org_type,
         o.street, o.city, o.state, o.zip, o.country, o.website,
         o.ntee_code, o.subsection_code, o.foundation_code, o.ruling_date,
         o.asset_amount, o.income_amount, o.revenue_amount,
         o.aum, o.fund_size, o.check_size_min, o.check_size_max, o.is_era,
         o.focus_areas, o.investment_stages, o.geographic_focus, o.thesis_text,
         o.status, o.last_verified_at,
         rf.dataset_name as source_dataset,
         rf.source_url   as source_url,
         o.source_record_locator,
         lm.license_code, lm.license_name,
         o.address_basis, o.address_object_id
  from internal.organizations o
  join internal.raw_files rf on rf.id = o.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- 0024's hygiene, repeated as 0024 asks of every file that (re)creates a
-- public view. A replaced view keeps its grants, so on a database where 0024
-- ran this changes nothing; it matters only where the view was dropped and
-- made again by hand. SELECT stays. On vanilla Postgres the two roles do not
-- exist and there is nothing to do.
do $$
declare
  roles text;
begin
  select string_agg(quote_ident(rolname), ', ') into roles
  from pg_roles where rolname in ('anon', 'authenticated');
  if roles is null then
    raise notice '0030: no anon/authenticated roles in this cluster; nothing to revoke';
    return;
  end if;
  execute format(
    'revoke insert, update, delete, truncate, references, trigger '
    'on public.organizations from %s', roles);
end $$;

-- ---------------------------------------------------------------------------
-- Check (by hand, read only):
--   select address_basis, count(*) from internal.organizations group by 1;
--       -- one row, NULL, until `funderdb derive org-address --apply` runs
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'organizations';   -- 35
--   uv run funderdb derive org-address --report
--
-- Undo (by hand, as the owner, in one transaction, after the loader has
-- stopped). Run `uv run funderdb derive org-address --unapply` FIRST, or the
-- cities and states the job wrote stay on the rows with nothing that says
-- where they came from.
--
-- Dropping the view drops EVERY grant on it, and not every grant is in a
-- migration of this repository. On the live database the view is read by
-- anon, authenticated, service_role, funder_ro, getfunded_app and by the
-- role of another app that no file here grants (six grantees on
-- 2026-10-08). So save the grants BEFORE the drop and put every one of them
-- back:
--   select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--     from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'organizations'
--    group by grantee;                    -- keep this output
--   begin;
--   set local lock_timeout = '500ms';
--   drop view public.organizations;      -- a view cannot lose a column in place
--   create view public.organizations as  -- 0003's text, 33 columns
--     ...;
--   -- one line for each grantee in the saved output, with the privileges it
--   -- had. On the live database that is at least:
--   --   grant select on public.organizations
--   --     to anon, authenticated, funder_ro, getfunded_app;
--   --   grant select on public.organizations to <the other app's role>;
--   --   grant all on public.organizations to service_role;
--   -- then 0024's revoke of the write privileges from anon and authenticated
--   -- (the block above), and run the saved query again: the two outputs must
--   -- be the same. A grantee that is missing after the undo gets "permission
--   -- denied" on its next read.
--   drop trigger trg_orgs_address_basis_release on internal.organizations;
--   drop function internal.tg_org_address_basis_release();
--   alter table internal.organizations
--     drop column address_basis, drop column address_object_id;
--   delete from internal.schema_migrations
--    where filename in ('0030_org_address_from_filings.sql',
--                       '0031_org_address_constraints_validate.sql');
--   commit;
-- ---------------------------------------------------------------------------

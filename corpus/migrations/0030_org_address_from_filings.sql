-- 0030: address as stated on the latest return.
--
-- Why. An organisation that is created from an e-filed return and is not in
-- the IRS master file has no address on its row: the return loader writes the
-- name and nothing else. Measured on the live database on 2026-10-08, read
-- only: 22,418 private foundations and 28,015 public charities have
-- `state is null`. Search filters by organizations.state, so none of them can
-- be found by state, and the Open Foundation List shows them with no city or
-- state. But every return carries the filer's own address in its header, and
-- the detail pass already stores it on internal.filings (filer_addr_line1,
-- filer_addr_line2, filer_city, filer_state, filer_zip, filer_country).
--
-- What this file adds. Two columns that say where an address came from, and
-- nothing else. No address is written here. `funderdb derive org-address
-- --apply` writes street, city, state and zip from the newest parsed,
-- non-superseded return, only where state and city are both empty, and sets
-- the two columns. `--unapply` puts those rows back.
--
--   address_basis      NULL             the address came with the row's own
--                                       source record (the IRS master file,
--                                       an SEC filing, a seed row), as before
--                      'filing_header'  street, city, state and zip are the
--                                       filer's address on one return
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
-- `funderdb migrate` is run again a little later.
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
  'Where street, city, state and zip came from. NULL: with the row''s own source record (the IRS master file for foundations and charities). ''filing_header'': the filer''s address on the return named in address_object_id, written by `funderdb derive org-address`.';
comment on column internal.organizations.address_object_id is
  'IRS OBJECT_ID of the return (internal.filings.object_id) that street, city, state and zip were taken from. Set exactly when address_basis is not NULL.';

-- ---------------------------------------------------------------------------
-- The label must stay true. Other loaders overwrite an organisation's
-- address: `funderdb ingest bmf` sets street, city, state and zip (and
-- raw_file_id) for every EIN in the master file, and it knows nothing about
-- these two columns. Without a guard, an organisation that appears in the
-- master file later would keep address_basis = 'filing_header' beside an
-- address that is now the master file's.
--
-- So: when a statement changes street, city, state or zip of a row whose
-- address_basis is set, and does not itself change the basis or the return
-- id, both go back to NULL ("the address came with the row's own source
-- record"). The derive job is not affected: its --apply starts from a NULL
-- basis, and its --unapply clears the basis in the same statement.
--
-- Cost. `update of street, city, state, zip` means the trigger is looked at
-- only for statements that name one of those columns, and the WHEN clause
-- means the function runs only for a row that has a basis and a changed
-- address. For every other update of this busy table nothing runs.
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
  'Clears address_basis and address_object_id when another writer changes the address of a row whose address came from a return.';

create trigger trg_orgs_address_basis_release
  before update of street, city, state, zip on internal.organizations
  for each row
  when (old.address_basis is not null
        and new.address_basis is not distinct from old.address_basis
        and new.address_object_id is not distinct from old.address_object_id
        and (new.street, new.city, new.state, new.zip)
            is distinct from (old.street, old.city, old.state, old.zip))
  execute function internal.tg_org_address_basis_release();

-- ---------------------------------------------------------------------------
-- public.organizations gains the two columns, at the end. `create or replace
-- view` may only append: the first 33 columns below are 0003's, same names,
-- same order, same types (checked against the live view on 2026-10-08). The
-- view keeps its owner and its grants, so every role that could read it can
-- read it now. No view depends on it.
--
-- Both columns are publishable: the address is the filer's own, on a public
-- return (us_public_domain), and the OBJECT_ID is already on public.filings.
-- The Open Foundation List reads address_basis from here.
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
-- Undo (by hand, as the owner, in one transaction). Run
-- `uv run funderdb derive org-address --unapply` FIRST, or the addresses the
-- job wrote stay on the rows with nothing that says where they came from.
--   begin;
--   set local lock_timeout = '500ms';
--   drop view public.organizations;      -- a view cannot lose a column in place
--   create view public.organizations as  -- 0003's text, 33 columns
--     ...;
--   -- then the grants the old view had: 0024's revoke, and SELECT for
--   -- funder_ro and getfunded_app (web migrations getfunded_0001 and 0010)
--   drop trigger trg_orgs_address_basis_release on internal.organizations;
--   drop function internal.tg_org_address_basis_release();
--   alter table internal.organizations
--     drop column address_basis, drop column address_object_id;
--   delete from internal.schema_migrations
--    where filename in ('0030_org_address_from_filings.sql',
--                       '0031_org_address_constraints_validate.sql');
--   commit;
-- ---------------------------------------------------------------------------

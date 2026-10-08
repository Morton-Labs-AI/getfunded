-- 0028: IRS standing — is this organization still recognized by the IRS today?
--
-- internal.organizations.status says 'active' for every foundation and
-- charity, and nothing ever checked it. Two IRS lists can:
--
--   * the Automatic Revocation of Exemption List (dataset irs_auto_revocation):
--     organizations whose exemption was revoked by operation of law because
--     they filed no return or notice for three years in a row. It holds NO
--     other kind of revocation (an examination, a termination).
--   * Publication 78 data (dataset irs_pub78): organizations that can receive
--     tax-deductible contributions, with a deductibility code.
--
-- Loaded by `funderdb ingest irs-standing` (src/funderdb/sources/irs_standing.py).
-- Both are U.S. Government works (us_public_domain), so both are republishable.
--
-- WHAT THIS FILE DOES NOT DO. It does not change internal.organizations.status
-- and it does not touch refresh_dashboard_stats(). Standing is read from the
-- view, next to the dates and the file it came from.
--
-- DOCTRINE (each rule is in the view, once, so every reader gets the same answer)
--
--   1. Standing is NULL until BOTH lists are loaded. With one list missing,
--      an organization outside the master file would be judged on half the
--      evidence.
--   2. A reinstatement counts only when its date is on or after the revocation
--      date. 88 rows carry an EARLIER reinstatement date (a second revocation
--      after an earlier reinstatement); those are not reinstated.
--   3. Dates are stored as filed. The IRS says a listed revocation date from
--      2020-04-01 to 2020-07-14 is wrong and should read 2020-07-15 (filing
--      dates were extended in the COVID-19 emergency; 31,685 rows).
--      effective_revocation_date carries the corrected date; revocation_date
--      keeps what the file says. Rule 2 compares against the date AS FILED,
--      because a retroactive reinstatement repeats the listed date.
--   4. Being absent from Publication 78 alone is never a negative: churches
--      and group-ruling subordinates are deductible without being listed.
--   5. No organization is called revoked on one list alone. An organization
--      on the revocation list that is also in the master file or on
--      Publication 78 is 'revoked_then_relisted' when a reinstatement or a
--      ruling date after the (corrected) revocation date explains it, and
--      'lists_disagree' when nothing does.
--   6. "Loaded" means the file a completed load points to
--      (internal.irs_list_snapshots, written in the load's own transaction),
--      never merely the newest file registered. Only rows of that file count.
--
-- KNOWN LIMIT. in_bmf is "the organization row was last written by a master
-- file load". After the next `ingest bmf --refresh`, an organization that left
-- the master file keeps its old raw_file_id and stays in_bmf = true. Before
-- that refresh, change in_bmf to "the row's file belongs to the newest
-- master-file vintage" (docs/DATA-SOURCES.md records this).

-- ---------------------------------------------------------------------------
-- Tables. Allow-list: EIN, legal name, exemption type and three dates from the
-- revocation list; EIN and deductibility codes from Publication 78. No street,
-- city, state, ZIP, country or doing-business-as name is ever loaded.
-- ---------------------------------------------------------------------------
create table if not exists internal.irs_revocations (
  ein                   text not null
                        constraint ck_irs_revocations_ein check (ein ~ '^[0-9]{9}$'),
  revocation_date       date not null,
  legal_name            text,
  exemption_type        text,
  posting_date          date,
  reinstatement_date    date,
  raw_file_id           bigint not null
                        constraint fk_irs_revocations_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  constraint pk_irs_revocations primary key (ein, revocation_date)
);

comment on table internal.irs_revocations is
  'IRS Automatic Revocation of Exemption List, every row, as filed. One row per (EIN, revocation date); an EIN can be revoked more than once.';
comment on column internal.irs_revocations.revocation_date is
  'Revocation date as the IRS file lists it. Dates from 2020-04-01 to 2020-07-14 should read 2020-07-15; the views carry that as effective_revocation_date.';
comment on column internal.irs_revocations.reinstatement_date is
  'Exemption reinstatement date as filed. It counts as a reinstatement only when it is on or after revocation_date.';
comment on column internal.irs_revocations.exemption_type is
  'IRS exemption type code as filed, e.g. 03 for section 501(c)(3).';

create table if not exists internal.irs_pub78 (
  ein                   text
                        constraint pk_irs_pub78 primary key
                        constraint ck_irs_pub78_ein check (ein ~ '^[0-9]{9}$'),
  deductibility_codes   text[] not null,
  raw_file_id           bigint not null
                        constraint fk_irs_pub78_raw_file references internal.raw_files(id),
  source_record_locator text not null
);

comment on table internal.irs_pub78 is
  'IRS Publication 78 data: organizations eligible to receive tax-deductible contributions. Absence from this list alone is never a negative.';
comment on column internal.irs_pub78.deductibility_codes is
  'IRS deductibility status codes as filed (PC, PF, POF, SO, ...), in file order.';

-- Which file each list currently holds. The loader writes this row in the
-- same transaction that swaps the list, so "the list dated X is loaded" is
-- true exactly when the rows of X are what a reader sees.
create table if not exists internal.irs_list_snapshots (
  dataset_name text
               constraint pk_irs_list_snapshots primary key
               constraint ck_irs_list_snapshots_dataset
                 check (dataset_name in ('irs_auto_revocation', 'irs_pub78')),
  raw_file_id  bigint not null
               constraint fk_irs_list_snapshots_raw_file references internal.raw_files(id),
  row_count    bigint not null,
  loaded_at    timestamptz not null default now()
);

comment on table internal.irs_list_snapshots is
  'The raw file each IRS list was last fully loaded from. Written by the loader inside the load transaction.';

-- ---------------------------------------------------------------------------
-- internal.irs_standing_vintage: always exactly one row. A NULL as-of date
-- means that list was never loaded. *_as_of is the IRS file date when the
-- server sent one (kind 'irs_file_date'), else the day we retrieved the file
-- (kind 'retrieved'); it is never the time the loader ran.
-- ---------------------------------------------------------------------------
create or replace view internal.irs_standing_vintage as
  select
    sr.raw_file_id   as revocation_list_raw_file_id,
    (coalesce(srf.source_last_modified, srf.fetched_at) at time zone 'UTC')::date
                     as revocation_list_as_of,
    case when sr.raw_file_id is null then null
         when srf.source_last_modified is not null then 'irs_file_date'
         else 'retrieved' end as revocation_list_as_of_kind,
    sr.row_count     as revocation_list_rows,
    sr.loaded_at     as revocation_list_loaded_at,
    sp.raw_file_id   as pub78_raw_file_id,
    (coalesce(prf.source_last_modified, prf.fetched_at) at time zone 'UTC')::date
                     as pub78_as_of,
    case when sp.raw_file_id is null then null
         when prf.source_last_modified is not null then 'irs_file_date'
         else 'retrieved' end as pub78_as_of_kind,
    sp.row_count     as pub78_rows,
    sp.loaded_at     as pub78_loaded_at
  from (values (1)) as one(x)
  left join internal.irs_list_snapshots sr on sr.dataset_name = 'irs_auto_revocation'
  left join internal.raw_files srf on srf.id = sr.raw_file_id
  left join internal.irs_list_snapshots sp on sp.dataset_name = 'irs_pub78'
  left join internal.raw_files prf on prf.id = sp.raw_file_id;

-- ---------------------------------------------------------------------------
-- internal.org_irs_standing: one row per foundation or charity with an EIN.
-- Written so `where org_id = $1` is index lookups only: organizations by
-- primary key, org_identifiers by org_id, the two snapshot rows, the latest
-- revocation row and the Publication 78 row by primary key. The file and
-- licence joins are left joins on primary keys, so a reader that asks only
-- for `standing` (the search filter) does not pay for them.
--
-- standing, in this order:
--   (NULL)                  one of the two lists is not loaded
--   listed                  no revocation row; in the master file or on Pub 78
--   not_listed              no revocation row; on neither list
--   revoked                 revocation row, not reinstated, on neither list
--   revoked_then_relisted   revocation row; in the master file or on Pub 78;
--                           reinstated, or a ruling date after the revocation
--   lists_disagree          revocation row; in the master file or on Pub 78;
--                           nothing explains it. Both facts are shown.
--   not_listed              revocation row with a reinstatement; on neither list
--
-- The "deciding file" (raw_file_id, source_record_locator, source_dataset,
-- source_url, license_*) is the revocation list whenever a revocation row
-- exists; else the master file for an organization in it; else Publication 78.
-- For not_listed with no row anywhere it is the Publication 78 file that was
-- searched, with the locator 'absent:EIN=<ein>'.
-- ---------------------------------------------------------------------------
create or replace view internal.org_irs_standing as
  select
    o.id       as org_id,
    o.org_type as org_type,
    i.id_value as ein,
    x.in_bmf,
    case when x.in_bmf
         then (coalesce(orf.source_last_modified, orf.fetched_at) at time zone 'UTC')::date
    end as bmf_as_of,
    case when x.in_bmf
         then case when orf.source_last_modified is not null
                   then 'irs_file_date' else 'retrieved' end
    end as bmf_as_of_kind,
    case when x.in_bmf then o.ruling_date end as bmf_ruling_date,
    -- The newest copy of the master file this database holds, on every row:
    -- "not in the master file" is a dated statement too. Uncorrelated, so it
    -- runs once per query, and not at all when the column is not read.
    (select (max(coalesce(b.source_last_modified, b.fetched_at)) at time zone 'UTC')::date
       from internal.raw_files b
      where b.dataset_name = 'irs_eo_bmf') as master_file_as_of,
    x.on_pub78,
    p.deductibility_codes as pub78_codes,
    r.revocation_date,
    r.effective_revocation_date,
    r.posting_date,
    r.reinstatement_date,
    x.reinstated,
    case
      when not x.loaded then null
      when not x.has_revocation and (x.in_bmf or x.on_pub78) then 'listed'
      when not x.has_revocation then 'not_listed'
      when not x.reinstated and not (x.in_bmf or x.on_pub78) then 'revoked'
      when (x.in_bmf or x.on_pub78)
           and (x.reinstated
                or coalesce(o.ruling_date > r.effective_revocation_date, false))
        then 'revoked_then_relisted'
      when x.in_bmf or x.on_pub78 then 'lists_disagree'
      else 'not_listed'
    end as standing,
    (coalesce(srf.source_last_modified, srf.fetched_at) at time zone 'UTC')::date
      as revocation_list_as_of,
    case when sr.raw_file_id is null then null
         when srf.source_last_modified is not null then 'irs_file_date'
         else 'retrieved' end as revocation_list_as_of_kind,
    (coalesce(prf.source_last_modified, prf.fetched_at) at time zone 'UTC')::date
      as pub78_as_of,
    case when sp.raw_file_id is null then null
         when prf.source_last_modified is not null then 'irs_file_date'
         else 'retrieved' end as pub78_as_of_kind,
    case when not x.loaded then null
         when x.has_revocation then sr.raw_file_id
         when x.in_bmf then o.raw_file_id
         else sp.raw_file_id end as raw_file_id,
    case when not x.loaded then null
         when x.has_revocation then r.source_record_locator
         when x.in_bmf then o.source_record_locator
         when x.on_pub78 then p.source_record_locator
         else 'absent:EIN=' || i.id_value end as source_record_locator,
    case when not x.loaded then null
         when x.has_revocation then srf.dataset_name
         when x.in_bmf then orf.dataset_name
         else prf.dataset_name end as source_dataset,
    case when not x.loaded then null
         when x.has_revocation then srf.source_url
         when x.in_bmf then orf.source_url
         else prf.source_url end as source_url,
    case when not x.loaded then null
         when x.has_revocation then slm.license_code
         when x.in_bmf then olm.license_code
         else plm.license_code end as license_code,
    case when not x.loaded then null
         when x.has_revocation then slm.license_name
         when x.in_bmf then olm.license_name
         else plm.license_name end as license_name,
    -- Every file behind the row may be republished: the organization row,
    -- its EIN, and both IRS lists.
    (x.loaded
     and coalesce(olm.republishable, false)
     and coalesce(ilm.republishable, false)
     and coalesce(slm.republishable, false)
     and coalesce(plm.republishable, false)) as republishable
  from internal.organizations o
  join internal.org_identifiers i on i.org_id = o.id and i.id_type = 'ein'
  join internal.raw_files orf on orf.id = o.raw_file_id
  -- The file each list was last fully loaded from (at most one row each).
  left join internal.irs_list_snapshots sr on sr.dataset_name = 'irs_auto_revocation'
  left join internal.irs_list_snapshots sp on sp.dataset_name = 'irs_pub78'
  left join lateral (
    select rv.revocation_date, rv.posting_date, rv.reinstatement_date,
           rv.source_record_locator,
           case when rv.revocation_date between date '2020-04-01' and date '2020-07-14'
                then date '2020-07-15' else rv.revocation_date end as effective_revocation_date
    from internal.irs_revocations rv
    where rv.ein = i.id_value
      and rv.raw_file_id = sr.raw_file_id
    order by rv.revocation_date desc
    limit 1
  ) r on true
  left join internal.irs_pub78 p
         on p.ein = i.id_value and p.raw_file_id = sp.raw_file_id
  cross join lateral (
    select (sr.raw_file_id is not null and sp.raw_file_id is not null) as loaded,
           (orf.dataset_name = 'irs_eo_bmf')                           as in_bmf,
           (p.ein is not null)                                         as on_pub78,
           (r.revocation_date is not null)                             as has_revocation,
           coalesce(r.reinstatement_date >= r.revocation_date, false)  as reinstated
  ) x
  left join internal.raw_files srf on srf.id = sr.raw_file_id
  left join internal.licensing_map slm on slm.license_code = srf.license_code
  left join internal.raw_files prf on prf.id = sp.raw_file_id
  left join internal.licensing_map plm on plm.license_code = prf.license_code
  left join internal.licensing_map olm on olm.license_code = orf.license_code
  left join internal.raw_files irf on irf.id = i.raw_file_id
  left join internal.licensing_map ilm on ilm.license_code = irf.license_code
  where o.org_type in ('private_foundation', 'public_charity');

comment on view internal.org_irs_standing is
  'IRS standing per foundation or charity EIN: listed, not_listed, revoked, revoked_then_relisted, lists_disagree, or NULL until both IRS lists are loaded. Carries the dates and the deciding file.';

-- ---------------------------------------------------------------------------
-- Public views — the publishability boundary (0003). Each one filters through
-- raw_files -> licensing_map, so a list whose licence stops being
-- republishable disappears from the public projection by itself.
-- ---------------------------------------------------------------------------
create or replace view public.irs_revocations as
  select r.ein, r.revocation_date,
         case when r.revocation_date between date '2020-04-01' and date '2020-07-14'
              then date '2020-07-15' else r.revocation_date end as effective_revocation_date,
         r.legal_name, r.exemption_type, r.posting_date, r.reinstatement_date,
         (coalesce(rf.source_last_modified, rf.fetched_at) at time zone 'UTC')::date as as_of,
         rf.dataset_name as source_dataset, rf.source_url,
         r.source_record_locator,
         lm.license_code, lm.license_name
  from internal.irs_revocations r
  join internal.raw_files rf on rf.id = r.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create or replace view public.irs_pub78 as
  select p.ein, p.deductibility_codes,
         (coalesce(rf.source_last_modified, rf.fetched_at) at time zone 'UTC')::date as as_of,
         rf.dataset_name as source_dataset, rf.source_url,
         p.source_record_locator,
         lm.license_code, lm.license_name
  from internal.irs_pub78 p
  join internal.raw_files rf on rf.id = p.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- One row per organization EIN, only once both lists are loaded.
create or replace view public.org_irs_standing as
  select s.org_id, s.ein, s.standing,
         s.in_bmf, s.bmf_as_of,
         s.revocation_date, s.effective_revocation_date, s.posting_date,
         s.reinstatement_date,
         s.on_pub78, s.pub78_codes as pub78_deductibility_codes,
         s.revocation_list_as_of, s.pub78_as_of,
         s.source_dataset, s.source_url, s.source_record_locator,
         s.license_code, s.license_name
  from internal.org_irs_standing s
  where s.standing is not null
    and s.republishable;

-- ---------------------------------------------------------------------------
-- Grant hygiene (0024). Supabase default privileges hand ALL on a new public
-- view to anon and authenticated; SELECT stays (anonymous reads of the public
-- projection are the stated goal), the write-shaped grants go. On vanilla
-- Postgres the two roles do not exist and there is nothing to revoke.
--
-- funder_ro (the analyst role, which runs model-written SQL) gets NOTHING on
-- the three new public views: they are not on the SQL guard's allowlist.
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
  roles text;
begin
  select string_agg(quote_ident(rolname), ', ') into roles
  from pg_roles where rolname in ('anon', 'authenticated');
  foreach v in array array['irs_revocations', 'irs_pub78', 'org_irs_standing']
  loop
    if roles is not null then
      execute format(
        'revoke insert, update, delete, truncate, references, trigger '
        'on public.%I from %s', v, roles);
    end if;
    execute format('revoke all on public.%I from funder_ro', v);
  end loop;
  if roles is null then
    raise notice '0028: no anon/authenticated roles in this cluster; nothing to revoke from them';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verification (by hand, read-only):
--   select * from internal.irs_standing_vintage;            -- one row; NULLs until loaded
--   select standing, count(*) from internal.org_irs_standing
--    where org_type = 'private_foundation' group by 1;      -- or `funderdb ingest irs-standing --report`
--   explain select * from internal.org_irs_standing where org_id = '<uuid>';  -- index scans only
--
-- Undo (drops only what this file made; nothing else depends on it):
--   drop view if exists public.org_irs_standing, public.irs_pub78, public.irs_revocations;
--   drop view if exists internal.org_irs_standing, internal.irs_standing_vintage;
--   drop table if exists internal.irs_list_snapshots, internal.irs_pub78, internal.irs_revocations;
--   delete from internal.schema_migrations where filename = '0028_irs_standing.sql';
-- ---------------------------------------------------------------------------

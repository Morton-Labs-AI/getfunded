-- 0032: IRS standing — two refinements to the view from 0028.
--
-- 0028 is applied and is not edited. This file replaces the two standing
-- views with `create or replace view`: every column 0028 made keeps its name,
-- its place and its type, and the new columns are added at the end. A replace
-- keeps the grants a view already has.
--
-- 1. A master-file copy that is OLDER than the revocation is not a second
--    opinion.
--
--    0028 rule 5 said: on the revocation list, not reinstated, and still in
--    the master file or on Publication 78 = 'lists_disagree'. But in_bmf only
--    means "the organization row was last written from the copy of the master
--    file we hold". When the IRS posted the revocation AFTER the date of that
--    copy, the copy could not know about it. The two files do not disagree;
--    one is simply older.
--
--    New rule 5a, tested after 'revoked_then_relisted' and before
--    'lists_disagree': an organization with a revocation row and no
--    reinstatement, that is in the master file, that Publication 78 does NOT
--    list, and whose revocation posting date is later than the date of the
--    master-file copy its row came from, is 'revoked'. The newer IRS list wins.
--
--    'lists_disagree' is kept for a real conflict:
--      * Publication 78 lists the organization (whatever the dates), or
--      * the master-file copy is as new as the posting date or newer, or
--      * the posting date is not on record.
--
--    The date compared is the date of the organization row's OWN file
--    (bmf_as_of), not the newest master file in the database, so the rule
--    stays right after a later master-file refresh. No new standing value:
--    a reader tells the two kinds of 'revoked' apart with in_bmf (true only
--    for rule 5a), bmf_as_of and posting_date, which every row carries.
--
-- 2. Returns filed for tax years after the revocation.
--
--    Some organizations on the revocation list kept filing. The IRS list is
--    still what it is, so the standing does not change. Two facts are added
--    so that a reader can see it:
--
--      filed_after_revocation   NULL when the organization has no revocation
--                               row. Else true when we hold a return whose
--                               tax year lies after the (corrected) revocation
--                               date: it ends more than 12 months after that
--                               date and, where the begin date is on record,
--                               begins after it. Else false.
--      latest_tax_period_end    the end of the newest tax year we hold a
--                               return for, NULL when we hold none.
--
--    Both read internal.filings by EIN (index ix_filings_ein; the ::bpchar
--    cast is what lets the index be used, because filings.ein is char(9)).
--    They join on the EIN and not on filings.org_id, which is NULL on some
--    rows. Only returns that are not superseded (an amended return replaces
--    its original) and whose file may be republished are read.
--
--    An organization that loses its exemption must still file, so a later
--    return does NOT show that the IRS reinstated it. It shows only that the
--    organization kept filing.
--
--    Both are scalar subqueries in the select list, so a reader that does not
--    ask for them does not pay for them (`select standing ...` still reads no
--    filing).
--
-- 3. A correction to a comment in 0028 (rule 2). 0028 says the 88 rows whose
--    reinstatement date is EARLIER than the revocation date are "a second
--    revocation after an earlier reinstatement". The list does not show that:
--    none of those EINs has an earlier revocation row. What the rows show is
--    only a reinstatement date before the revocation date. The rule itself is
--    unchanged: such a date does not count as a reinstatement.
--
-- public.org_irs_standing gains, at the end: filed_after_revocation,
-- latest_tax_period_end, and master_file_as_of (the date of the newest
-- master-file copy in the database, so a published file can print it).
--
-- Locks: a replace takes ACCESS EXCLUSIVE on the two views only, for an
-- instant. No table is locked beyond ACCESS SHARE. If a long reader holds a
-- view, this stops after 3 seconds and changes nothing; run migrate again.
set local lock_timeout = '3s';

create or replace view internal.org_irs_standing as
  select
    o.id       as org_id,
    o.org_type as org_type,
    i.id_value as ein,
    x.in_bmf,
    case when x.in_bmf then x.bmf_file_date end as bmf_as_of,
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
      -- Rule 5a (0032): only a master-file copy older than the revocation
      -- posting still names it, and Publication 78 does not. Not reinstated
      -- and no later ruling date, or the branch above would have matched.
      when x.in_bmf and not x.on_pub78
           and coalesce(r.posting_date > x.bmf_file_date, false)
        then 'revoked'
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
     and coalesce(plm.republishable, false)) as republishable,
    -- 0032, added at the end. See point 2 in the header.
    case when x.has_revocation then exists (
      select 1
      from internal.filings f
      join internal.raw_files frf on frf.id = f.raw_file_id
      join internal.licensing_map flm on flm.license_code = frf.license_code
      where f.ein = i.id_value::bpchar
        and f.superseded_by_object_id is null
        and flm.republishable
        and f.tax_period_end > (r.effective_revocation_date + interval '1 year')::date
        and (f.tax_period_begin is null
             or f.tax_period_begin > r.effective_revocation_date))
    end as filed_after_revocation,
    (select max(f.tax_period_end)
       from internal.filings f
       join internal.raw_files frf on frf.id = f.raw_file_id
       join internal.licensing_map flm on flm.license_code = frf.license_code
      where f.ein = i.id_value::bpchar
        and f.superseded_by_object_id is null
        and flm.republishable) as latest_tax_period_end
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
           coalesce(r.reinstatement_date >= r.revocation_date, false)  as reinstated,
           -- The date of the file the organization row came from. It is the
           -- master-file date only when in_bmf; every use checks in_bmf.
           (coalesce(orf.source_last_modified, orf.fetched_at) at time zone 'UTC')::date
                                                                       as bmf_file_date
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
  'IRS standing per foundation or charity EIN: listed, not_listed, revoked, revoked_then_relisted, lists_disagree, or NULL until both IRS lists are loaded. Carries the dates and the deciding file. revoked with in_bmf = true means the master-file copy is older than the IRS posting date of the revocation (0032). filed_after_revocation and latest_tax_period_end come from the returns on file.';

comment on column internal.org_irs_standing.filed_after_revocation is
  'NULL without a revocation row. True when a return on file covers a tax year after the (corrected) revocation date. A later return does not show a reinstatement: an organization that loses its exemption must still file.';
comment on column internal.org_irs_standing.latest_tax_period_end is
  'End of the newest tax year a return is on file for (not superseded, republishable). NULL when no return is on file.';

-- One row per organization EIN, only once both lists are loaded. The first
-- 18 columns are 0028's, unchanged; three are added at the end.
create or replace view public.org_irs_standing as
  select s.org_id, s.ein, s.standing,
         s.in_bmf, s.bmf_as_of,
         s.revocation_date, s.effective_revocation_date, s.posting_date,
         s.reinstatement_date,
         s.on_pub78, s.pub78_codes as pub78_deductibility_codes,
         s.revocation_list_as_of, s.pub78_as_of,
         s.source_dataset, s.source_url, s.source_record_locator,
         s.license_code, s.license_name,
         s.filed_after_revocation, s.latest_tax_period_end,
         s.master_file_as_of
  from internal.org_irs_standing s
  where s.standing is not null
    and s.republishable;

-- ---------------------------------------------------------------------------
-- Grant hygiene, the same as 0028 (and 0024). A replace keeps the grants the
-- view already has, so this changes nothing on a database where 0028 ran; it
-- is repeated so that the end state does not depend on that. anon and
-- authenticated keep SELECT only. funder_ro (the analyst role, which runs
-- model-written SQL) has nothing on the view. The grant on the internal view
-- to the web app's role is made by the web migrations and is kept.
-- ---------------------------------------------------------------------------
do $$
declare
  roles text;
begin
  select string_agg(quote_ident(rolname), ', ') into roles
  from pg_roles where rolname in ('anon', 'authenticated');
  if roles is not null then
    execute format(
      'revoke insert, update, delete, truncate, references, trigger '
      'on public.org_irs_standing from %s', roles);
  else
    raise notice '0032: no anon/authenticated roles in this cluster; nothing to revoke from them';
  end if;
  revoke all on public.org_irs_standing from funder_ro;
end $$;

-- ---------------------------------------------------------------------------
-- Verification (by hand, read-only):
--   select column_name from information_schema.columns
--    where table_schema = 'internal' and table_name = 'org_irs_standing'
--    order by ordinal_position desc limit 2;   -- latest_tax_period_end, filed_after_revocation
--   `funderdb ingest irs-standing --report` prints the counts under the 0028
--   rule and under this one, side by side.
--   explain select standing from internal.org_irs_standing where org_id = '<uuid>';
--     -- index scans only, and internal.filings is not in the plan
--
-- Undo: there is no file to drop. To go back to the 0028 rule, replace the
-- two views again without the "Rule 5a" branch (the added columns must stay:
-- a view cannot lose a column in a replace), or drop both views and run the
-- two `create or replace view ... org_irs_standing` statements of 0028, then
-- give the web app's role its grant again (web migration getfunded_0013).
--   delete from internal.schema_migrations where filename = '0032_irs_standing_refinements.sql';
-- ---------------------------------------------------------------------------

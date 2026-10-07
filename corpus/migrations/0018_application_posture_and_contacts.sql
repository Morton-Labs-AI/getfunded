-- 0018: application posture, contact classifiers, and closing a contact leak.
--
-- WHY: 990-PF Part XV records whether a foundation accepts unsolicited
-- applications. Measured 2026-08-09 over the 145,200 orgs with a parsed
-- 990-PF: 26,864 are OPEN, 101,773 say they fund only PRESELECTED
-- organizations, and 16,563 say nothing either way. That is the single most
-- decision-relevant fact for a grantseeker and it was reachable only by
-- opening one filing at a time.
--
-- THE LOAD-BEARING RULE: posture comes from the latest PARSED filing, never
-- the latest filing. 35,648 filings are indexed by the IRS but have never been
-- published in a bulk zip, so they have no XML and no Part XV. If they win the
-- "latest" race they convert a known posture into 'unknown' — measured, that
-- inflates unknown 2.2x (16,563 -> 36,251) and mislabels 3,806 OPEN
-- foundations as unstated. Inner-joining filing_financials is what makes
-- "latest parsed" precise, and it guarantees this MV and
-- mv_org_latest_financials elect the SAME object_id per org, which is what
-- makes them joinable. Benchmark F3 gates it.
--
-- 'unknown' IS NOT 'closed'. It is an absence of a statement. Every
-- grantmaking public charity is 'unknown' (they file 990, which has no
-- Part XV) — including ClimateWorks, Hewlett and the Energy Foundation, which
-- are the E5 semantic fixture. Any consumer defaulting to open-only silently
-- deletes them.

-- ---------------------------------------------------------------------------
-- Contact classifiers. SQL twins of no Python — these are the definition, so
-- benchmarks and the loader call the same code. Same shape as
-- internal.norm_name (0009:20-28): immutable, parallel safe, search_path ''.
-- ---------------------------------------------------------------------------

-- The flattened local part of an email, or NULL when the value is not an
-- address at all. Measured 2026-08-09: 1,404 of 8,978 Part XV "emails" are
-- not addresses ('N/A', 'None', 'Not Applicable',
-- 'www.jpmorgan.com/onlinegrants'). The validity gate runs BEFORE
-- classification so junk can never be published.
create function internal.email_local_flat(addr text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.lower(pg_catalog.btrim(addr))
         ~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
    then pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(
             pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(addr), '@', 1)),
             '\+.*$', ''),
           '[._-]', '', 'g')
  end
$$;

-- Is this a ROLE inbox (grants@, info@) rather than a named individual's
-- address (alan_topfer@)? Only role inboxes are ever published; the default is
-- false, matching the publishability DEFAULT 'internal_only' doctrine at
-- 0002:230 — publishing is an affirmative act.
--
-- Evaluation order matters and each step exists for a measured reason:
--   1. not an address                          -> false
--   2. sentinel junk                           -> false
--   3. PERSONAL-NAME OVERRIDE, checked BEFORE any role hit. Demotes 63
--      otherwise-role-looking rows where the filer's own contact name appears
--      inside the local part.
--   4. WHOLE-TOKEN allowlist, never a prefix — so the surnames Grantham,
--      Boardman, Donatelli and Mainwaring cannot be read as 'grant', 'board',
--      'donations' or 'main'.
--   5. a narrow compound-prefix set for things that cannot be surnames. Note
--      'grants' and NOT 'grant', precisely to exclude Grantham.
create function internal.is_role_based_email(addr text, contact_name text)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  with f as (
    select pg_catalog.regexp_replace(
             pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(addr), '@', 1)),
             '\+.*$', '') as local_raw,
           internal.email_local_flat(addr) as flat
    where internal.email_local_flat(addr) is not null
  )
  select case
    when not exists (select 1 from f) then false
    when (select flat from f) = any (array[
      'na','none','notapplicable','notapplicible','unknown','nil','null',
      'test','email','noemail','nota','n','x','xx','xxx']) then false
    when exists (
      select 1 from f,
        pg_catalog.regexp_split_to_table(
          pg_catalog.regexp_replace(
            pg_catalog.lower(coalesce(contact_name, '')),
            '[^a-z ]', ' ', 'g'), '\s+') as tok
      where pg_catalog.length(tok) >= 4
        and pg_catalog.strpos(f.flat, tok) > 0
    ) then false
    when exists (
      select 1 from f,
        pg_catalog.regexp_split_to_table(f.local_raw, '[._-]') as tok
      where tok = any (array[
        'grants','grant','grantsinfo','grantinfo','grantsadmin','grantadmin',
        'apply','application','applications','foundation','fdn','info',
        'information','contact','contactus','admin','office','mail','email',
        'inquiries','inquiry','enquiries','enquiry','general','hello','help',
        'support','giving','philanthropy','charity','charitable','scholarship',
        'scholarships','proposals','proposal','trustee','trustees','secretary',
        'treasurer','executivedirector','execdir','director','president',
        'board','staff','team','reception','frontdesk','finaid','donations',
        'main','contactus','grantsmanager','programs','program'])
    ) then true
    when (select flat from f) ~
         '^(grants|foundation|scholarship|application|inquir|enquir|philanthrop|frontdesk)'
      then true
    else false
  end
$$;

-- NANP phone in E.164, or NULL. Storing the normalized form (not the as-filed
-- string) is what makes uq_contact dedupe correctly across filings, and the
-- area/exchange rules kill the 50 repeated-digit junk rows (5555555555).
create function internal.nanp_e164(p text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when pg_catalog.regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')
         ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$'
    then '+1' || pg_catalog.regexp_replace(p, '[^0-9]', '', 'g')
  end
$$;

-- ---------------------------------------------------------------------------
-- mv_org_application_posture: one row per org, from its latest PARSED
-- non-superseded 990-PF. Mirrors mv_org_latest_financials (0016:140-162).
--
-- Email and phone VALUES are deliberately absent — only has_email/has_phone
-- booleans. The values live in internal.contact_channels, which is the only
-- surface in this database with privacy tiering, an explicit publishability
-- flag, and a license-guard trigger. A channel routes there or it is not
-- published.
--
-- raw_file_id is carried (unlike mv_org_latest_financials) because this MV
-- gets a public.* view and must join raw_files -> licensing_map like every
-- other published relation.
-- ---------------------------------------------------------------------------
create materialized view internal.mv_org_application_posture as
  select org_id, object_id, ein, tax_period, tax_period_end, fy,
         has_part_xv, only_preselected, application_posture,
         contact_name, app_city, app_state, app_zip,
         has_email, has_phone, n_actionable,
         form_and_info_txt, submission_deadlines_txt, restrictions_txt,
         raw_file_id, source_record_locator
  from (
    select f.org_id, f.object_id, f.ein, f.tax_period, f.tax_period_end,
           nullif(left(f.tax_period, 4), '')::smallint as fy,
           (fa.object_id is not null) as has_part_xv,
           fa.only_preselected,
           case when fa.object_id is null then 'unknown'
                when fa.only_preselected  then 'preselected_only'
                else                           'open' end as application_posture,
           fa.contact_name,
           fa.city as app_city, fa.state as app_state, fa.zip as app_zip,
           (internal.email_local_flat(fa.email) is not null) as has_email,
           (internal.nanp_e164(fa.phone) is not null) as has_phone,
           num_nonnulls(fa.contact_name, fa.email, fa.phone,
                        fa.form_and_info_txt, fa.submission_deadlines_txt,
                        fa.restrictions_txt)::smallint as n_actionable,
           fa.form_and_info_txt, fa.submission_deadlines_txt, fa.restrictions_txt,
           f.raw_file_id,
           coalesce(fa.source_record_locator, 'row:object_id=' || f.object_id)
             as source_record_locator,
           row_number() over (partition by f.org_id
                              order by f.tax_period desc, f.object_id desc) as rn
    from internal.filings f
    -- INNER JOIN: "latest PARSED filing". See the header comment — this is the
    -- correctness rule, not an optimization.
    join internal.filing_financials ff on ff.object_id = f.object_id
    left join internal.filing_application_info fa on fa.object_id = f.object_id
    where f.org_id is not null
      and f.return_type = '990PF'
      and f.superseded_by_object_id is null
  ) t
  where rn = 1;

-- The unique index is REQUIRED, not an optimization: the browse page joins
-- this MV inside a keyset-paginated query, and a duplicate org_id would
-- multiply rows and silently corrupt the cursor.
create unique index uq_mv_org_app_posture on internal.mv_org_application_posture (org_id);
create index ix_mv_org_app_posture_open
  on internal.mv_org_application_posture (application_posture, app_state);

grant select on internal.mv_org_application_posture to funder_ro;

create view public.org_application_posture as
  select p.org_id, p.object_id, p.ein, p.tax_period, p.tax_period_end, p.fy,
         p.has_part_xv, p.only_preselected, p.application_posture,
         p.contact_name, p.app_city, p.app_state, p.app_zip,
         p.has_email, p.has_phone, p.n_actionable,
         p.form_and_info_txt, p.submission_deadlines_txt, p.restrictions_txt,
         p.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url,
         lm.license_code, lm.license_name
  from internal.mv_org_application_posture p
  join internal.raw_files rf on rf.id = p.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- ---------------------------------------------------------------------------
-- Close the contact leak.
--
-- As shipped in 0016, public.filing_application_info exposed contact_name,
-- phone AND email for all 411,840 Part XV rows with NONE of the three safety
-- layers contact_channels has (no privacy_tier, no publishability, no
-- license-guard trigger). Because the source is us_public_domain, every row
-- passed the republishable filter; only the absence of an anon grant kept it
-- private.
--
-- The split: a NAME is not a channel — public.filing_officers already
-- publishes 1.44M officer names from these same returns, so withholding
-- contact_name here would be incoherent. An EMAIL and a PHONE are channels:
-- they enable unsolicited direct contact at scale, and this database has
-- exactly one place where a channel's publishability is structurally
-- enforced. They route through contact_channels or they are not published.
--
-- Same one-line-to-reverse shape as the existing column withholdings at
-- 0003:37-38 (people.linkedin_url) and 0016:74-75 (filing_contributors.street).
-- ---------------------------------------------------------------------------
drop view public.filing_application_info;

create view public.filing_application_info as
  select fa.object_id, fa.ein, fa.contact_name,
         fa.addr_line1, fa.addr_line2, fa.city, fa.state, fa.zip,
         -- fa.phone and fa.email deliberately excluded: channels route
         -- through internal.contact_channels, the only tiered surface.
         fa.form_and_info_txt, fa.submission_deadlines_txt, fa.restrictions_txt,
         fa.only_preselected,
         fa.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.filing_application_info fa
  join internal.raw_files rf on rf.id = fa.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create or replace function internal.refresh_dashboard_stats() returns void
language sql
set search_path = ''
as $$
  refresh materialized view internal.mv_overview_totals;
  refresh materialized view internal.mv_org_type_counts;
  refresh materialized view internal.mv_org_state_counts;
  refresh materialized view internal.mv_event_type_totals;
  refresh materialized view internal.mv_events_by_year;
  refresh materialized view internal.mv_top_funders;
  refresh materialized view internal.mv_amount_histogram;
  refresh materialized view internal.mv_funder_event_stats;
  refresh materialized view internal.mv_recipient_event_stats;
  refresh materialized view internal.mv_org_latest_financials;
  refresh materialized view internal.mv_org_application_posture;
$$;

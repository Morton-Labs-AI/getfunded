-- 0023: filer-stated websites, from the filings we already hold.
--
-- WebsiteAddressTxt exists in the staged XML for BOTH form types (verified
-- against real members 2026-08-10):
--   Form 990:    ReturnData/IRS990/WebsiteAddressTxt
--   Form 990-PF: ReturnData/IRS990PF/StatementsRegardingActyGrp/WebsiteAddressTxt
--
-- This is first-party us_public_domain data — the filer states its own
-- website on a public filing — so unlike org_web_facts (publisher_website,
-- republishable=false, human-gated) it flows to public views and the CC-BY
-- export. The org row's website column stays untouched: its provenance is the
-- BMF/SBIR/ADV file that made the row (0012's reasoning). Filing-stated
-- websites live on the filing row, whose raw_file_id IS the zip the XML came
-- from — provenance for free.
--
-- Precedence doctrine (F3): the website an org "has" comes from the latest
-- PARSED filing, never the latest filing — website_parsed_at is only stamped
-- when the XML was actually read, so a never-zip-packaged filing can't win.

alter table internal.filings add column if not exists website text;
alter table internal.filings add column if not exists website_parsed_at timestamptz;

-- Per-org latest-website lookups (profile pages, the enrich queue).
create index if not exists ix_filings_org_website
  on internal.filings (org_id, tax_period desc)
  where website is not null;

create or replace view internal.org_website as
  select distinct on (f.org_id)
         f.org_id, f.website, f.object_id, f.tax_period, f.return_type
    from internal.filings f
   where f.website is not null
     and f.website_parsed_at is not null
     and f.superseded_by_object_id is null
     and f.org_id is not null
   order by f.org_id, f.tax_period desc, f.object_id desc;

grant select on internal.org_website to funder_ro;

-- public.filings gains the website column. Same-file drop+recreate pattern as
-- 0017/0021; definition is 0016's verbatim plus `f.website` after
-- superseded_by_object_id. anon/authenticated re-acquire their default ACLs
-- at creation; funder_ro re-granted explicitly below.
drop view public.filings;
create view public.filings as
  select f.object_id, f.ein, f.org_id, f.return_type, f.tax_period,
         f.tax_period_begin, f.tax_period_end, f.sub_date, f.dln,
         f.xml_batch_id, f.taxpayer_name, f.return_version, f.amended_return,
         f.return_ts, f.phone, f.in_care_of_name,
         f.filer_addr_line1, f.filer_addr_line2, f.filer_city, f.filer_state,
         f.filer_zip, f.filer_country, f.accounting_method,
         f.signing_officer_name, f.signing_officer_title, f.signature_date,
         f.superseded_by_object_id,
         f.website,
         f.object_id || '_public.xml' as xml_member_name,
         case when coalesce(f.xml_batch_id, '') <> '' then
           'https://apps.irs.gov/pub/epostcard/990/xml/'
             || left(f.xml_batch_id, 4) || '/' || upper(f.xml_batch_id) || '.zip'
         end as xml_zip_url,
         rf.dataset_name as source_dataset, rf.source_url,
         lm.license_code, lm.license_name
  from internal.filings f
  join internal.raw_files rf on rf.id = f.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

grant select on public.filings to funder_ro;

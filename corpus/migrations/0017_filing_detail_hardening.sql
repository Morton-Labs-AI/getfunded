-- 0017: widen filer-controlled numeric columns.
--
-- First real-data contact: a Schedule B ContributorNum of "20250001"
-- (filer-entered, evidently a date-ish serial) overflowed smallint on COPY.
-- Filer-entered numbers get integer/unconstrained-numeric headroom; the
-- parser additionally clamps absurdities to NULL (int4 range for
-- contributor_num, < 1e6 for avg hours/week).
--
-- The 0016 views pin these column types, so they are dropped and recreated
-- verbatim around the ALTERs.

drop view public.filing_contributors;
drop view public.filing_officers;

alter table internal.filing_contributors
  alter column contributor_num type integer,
  alter column seq type integer;

alter table internal.filing_officers
  alter column seq type integer,
  alter column avg_hours_per_week type numeric;

create view public.filing_officers as
  select fo.id, fo.object_id, fo.ein, fo.seq, fo.person_name, fo.business_name,
         fo.title, fo.avg_hours_per_week, fo.compensation,
         fo.employee_benefits, fo.expense_account,
         fo.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.filing_officers fo
  join internal.raw_files rf on rf.id = fo.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- street deliberately excluded (stored internally; publicly disclosable, but
-- withheld from the export surface until there is a reason to publish it).
create view public.filing_contributors as
  select fc.id, fc.object_id, fc.ein, fc.seq, fc.contributor_num,
         fc.person_name, fc.business_name, fc.city, fc.state, fc.zip,
         fc.country, fc.total_contributions,
         fc.is_person, fc.is_payroll, fc.is_noncash,
         fc.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.filing_contributors fc
  join internal.raw_files rf on rf.id = fc.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

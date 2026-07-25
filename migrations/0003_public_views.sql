-- 0003: public views — the publishability boundary.
--
-- Owner-rights views (NOT security_invoker), deliberately: Phase 1 has no RLS,
-- so owner-rights is what makes "reader sees only the filtered projection" work
-- without granting anything on `internal`. Flip to security_invoker in Phase 2
-- when RLS lands. Nothing is granted to anon/authenticated in Phase 1 — there
-- is no public API yet; turning one on later is one `grant select` per view.
--
-- Public dataset exports read ONLY from these views. Never a view over
-- raw_files storage paths or the ingestion ledger.

create view public.organizations as
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
         lm.license_code, lm.license_name
  from internal.organizations o
  join internal.raw_files rf on rf.id = o.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create view public.org_identifiers as
  select i.id, i.org_id, i.id_type, i.id_value, i.confidence,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.org_identifiers i
  join internal.raw_files rf on rf.id = i.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- people: linkedin_url and source_natural_key deliberately excluded until the
-- yellow-tier publication policy is settled.
create view public.people as
  select p.id, p.full_name, p.first_name, p.last_name,
         p.primary_org_id, p.primary_title, p.is_individual_funder, p.bio_url,
         rf.dataset_name as source_dataset, rf.source_url,
         p.source_record_locator
  from internal.people p
  join internal.raw_files rf on rf.id = p.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create view public.funding_programs as
  select fp.id, fp.administering_org_id, fp.name, fp.program_type, fp.program_code,
         fp.description, fp.eligibility, fp.award_floor, fp.award_ceiling,
         fp.non_dilutive, fp.funds_lab_not_company,
         fp.open_date, fp.close_date, fp.status, fp.url,
         rf.dataset_name as source_dataset, rf.source_url,
         fp.source_record_locator
  from internal.funding_programs fp
  join internal.raw_files rf on rf.id = fp.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create view public.funding_events as
  select fe.id, fe.event_type, fe.funder_org_id, fe.funder_person_id, fe.program_id,
         fe.recipient_org_id, fe.recipient_name, fe.recipient_city, fe.recipient_state,
         fe.event_date, fe.fiscal_year, fe.amount, fe.currency, fe.purpose_text,
         rf.dataset_name as source_dataset, rf.source_url,
         fe.source_record_locator
  from internal.funding_events fe
  join internal.raw_files rf on rf.id = fe.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create view public.relationships as
  select r.id, r.from_person_id, r.from_org_id, r.to_org_id, r.rel_type,
         r.title, r.start_date, r.end_date, r.confidence,
         rf.dataset_name as source_dataset, rf.source_url,
         r.source_record_locator
  from internal.relationships r
  join internal.raw_files rf on rf.id = r.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- contact_channels: triple filter — explicit publishability, non-red tier
-- (redundant with the CHECK; defense in depth), republishable source.
create view public.contact_channels as
  select c.id, c.org_id, c.person_id, c.channel_type, c.value, c.is_role_based,
         c.privacy_tier, c.last_verified_at,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.contact_channels c
  join internal.raw_files rf on rf.id = c.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where c.publishability = 'public'
    and c.privacy_tier <> 'red'
    and lm.republishable;

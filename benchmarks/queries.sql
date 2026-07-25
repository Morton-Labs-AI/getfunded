-- Open Funder Database — Phase 1 benchmark suite.
-- The DoD gate: all queries return sane, provenance-bearing results.
-- Run against internal.* (canonical). Queries marked PENDING need a source
-- that lands at a later gate; they must pass before Phase 1 closes.

-- B1. Federal non-dilutive discovery (Morton Labs need #1) ------------------
-- Expect: DOE SBIR/STTR, INFUSE, ARPA-E, FES Milestone program.
select fp.name, agency.name as agency, fp.program_type, fp.funds_lab_not_company, fp.url
from internal.funding_programs fp
join internal.organizations agency on agency.id = fp.administering_org_id
where fp.non_dilutive
  and (fp.search_tsv @@ websearch_to_tsquery('fusion or plasma')
       or agency.search_tsv @@ websearch_to_tsquery('fusion or plasma'))
order by fp.name;

-- B2. SBIR/STTR-participating agencies with energy focus --------------------
select distinct agency.name, fp.name as program, fp.url
from internal.funding_programs fp
join internal.organizations agency on agency.id = fp.administering_org_id
where fp.program_type in ('sbir','sttr')
order by agency.name;

-- B3. Named VC targets resolve (PENDING: G3 sec_form_adv) -------------------
-- Prelude Ventures + Lowercarbon Capital must resolve (likely ERAs).
-- Fundable Fusion / Rutherford Energy Ventures may be legitimately absent
-- (too small/new to file ADV) — documented absence = pass; silent miss = fail.
select o.name, o.org_type, o.is_era, o.state, o.aum,
       i.id_type, i.id_value
from internal.organizations o
left join internal.org_identifiers i on i.org_id = o.id and i.id_type = 'crd'
where o.name_normalized % any (array[
        'PRELUDE VENTURES', 'LOWERCARBON CAPITAL', 'LOWER CARBON CAPITAL',
        'FUNDABLE FUSION', 'RUTHERFORD ENERGY VENTURES'])
   or o.name ilike any (array['%prelude venture%','%lowercarbon%','%fundable fusion%',
                              '%rutherford energy%']);

-- B4. VC discovery: climate/energy advisers (PENDING: G3 sec_form_adv) ------
select o.name, o.state, o.aum, o.is_era
from internal.organizations o
where o.org_type in ('investment_adviser','vc','pe')
  and o.search_tsv @@ websearch_to_tsquery('climate or energy or carbon')
order by o.aum desc nulls last
limit 50;

-- B5. Named philanthropic targets ------------------------------------------
-- Expect Schmidt-family foundations + Stellar Energy Foundation rows w/ EIN.
select o.name, o.city, o.state, o.asset_amount, i.id_value as ein
from internal.organizations o
join internal.org_identifiers i on i.org_id = o.id and i.id_type = 'ein'
where o.org_type = 'private_foundation'
  and (o.name ilike '%schmidt%' or o.name ilike '%stellar energy%')
order by o.asset_amount desc nulls last
limit 25;

-- B6. Philanthropic discovery: energy/science foundations by assets ---------
select o.name, o.city, o.state, o.asset_amount, o.ntee_code
from internal.organizations o
where o.org_type = 'private_foundation'
  and o.search_tsv @@ websearch_to_tsquery('energy or science or research')
  and o.asset_amount > 10000000
order by o.asset_amount desc
limit 50;

-- B7. Combo: Illinois foundations, science/energy, assets > $10M ------------
select o.name, o.city, o.asset_amount, o.ntee_code
from internal.organizations o
where o.org_type = 'private_foundation'
  and o.state = 'IL'
  and (o.search_tsv @@ websearch_to_tsquery('science or energy or research')
       or o.ntee_code like 'U%')   -- NTEE U = science & technology
  and o.asset_amount > 10000000
order by o.asset_amount desc
limit 50;

-- B8. Grants evidence (PENDING: G4 irs_990pf_xml) ---------------------------
-- Foundations whose actual grants-paid mention energy/science.
select funder.name as foundation, fe.recipient_name, fe.amount, fe.purpose_text,
       fe.fiscal_year
from internal.funding_events fe
join internal.organizations funder on funder.id = fe.funder_org_id
where fe.event_type = 'grant'
  and fe.search_tsv @@ websearch_to_tsquery('energy or physics or "scientific research"')
order by fe.amount desc nulls last
limit 50;

-- B9. Recent raisers (PENDING: G5 sec_form_d) -------------------------------
-- Pooled investment funds (VC type) with offerings in the last 12 months.
select o.name, fe.event_date, fe.amount, fe.source_record_locator
from internal.funding_events fe
join internal.organizations o on o.id = fe.recipient_org_id
where fe.event_type = 'reg_d_offering'
  and fe.event_date > current_date - interval '12 months'
order by fe.event_date desc
limit 50;

-- B10. Provenance round-trip -----------------------------------------------
-- Every org must trace to a hashed raw file with a license. Expect 0 orphans
-- (structurally guaranteed by NOT NULL FKs; this asserts the join is clean).
select count(*) as orgs_total,
       count(*) filter (where rf.sha256 is null or lm.license_code is null) as orphans
from internal.organizations o
left join internal.raw_files rf on rf.id = o.raw_file_id
left join internal.licensing_map lm on lm.license_code = rf.license_code;

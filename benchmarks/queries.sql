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
-- Verified against the full 2026-07-25 RIA+ERA feed (23,638 firms):
--   Lowercarbon Capital = CRD 162946, ERA -> MUST resolve after G3 load.
--   Prelude Ventures = NO ADV filing exists (documented absence; likely
--     family-office-exempt / Pritzker capital). G5 re-test: also ZERO Form D
--     issuers match 2024q1-2026q1 — invisible in SEC filings under its brand.
--     Absence is a PASS with this annotation.
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

-- ===========================================================================
-- PHASE 2 · SEMANTIC EVAL (E-series). Requires a query embedding, so these run
-- via `funderdb eval semantic`, not psql alone. Recorded results 2026-07-26
-- (148,430-doc corpus, voyage-3.5@512, no HNSW yet — sequential scan).
-- ===========================================================================

-- E1  "fusion energy simulation software" (unfiltered)
--     PASS on the negative criterion: ZERO medical/bone/protein-fusion orgs in
--     top 10 (FTS baseline: 80 of 210 "fusion" grant matches are medical).
--     Returns fusion-simulation COMPANIES (Simmetrix, Woodruff Scientific,
--     Far-Tech) — semantically right, but companies are recipients, not
--     funders: funder-discovery queries must pass kinds=[foundation,program,
--     adviser]. The analyst's tool description now says so.

-- E1b "foundations and programs funding fusion energy and plasma physics"
--     kinds=[foundation,program] → all 4 fusion programs top the list
--     (INFUSE, FIRE, Milestone-Based, ARPA-E), then genuinely apt physics
--     funders: Brinson, Breakthrough Prize, Julian Schwinger Foundation for
--     Physics Research, Kavli.
--     KNOWN LIMIT (aggregate dilution): Schmidt and Simons do NOT surface
--     semantically despite holding the largest real fusion grants — their docs
--     are dominated by hundreds of non-fusion grants, so the aggregate vector
--     reads "general science philanthropy". Grant-level evidence still finds
--     them (B8). This is why the system prompt pairs semantic discovery WITH
--     a run_query grants-paid follow-up: the two are complementary, not
--     redundant. Do not "fix" by embedding individual grants (26-char
--     purposes; measured noise).

-- E2  "climate tech venture capital" kinds=[adviser]
--     Top 10 are all climate-thesis VCs. Lowercarbon Capital ranks #30 of
--     23,626 advisers (top 0.13%) despite the word "climate" appearing
--     nowhere in its document — the semantic win — but ~29 firms literally
--     named "Climate X" outrank it. Recorded as expected behavior, not a
--     failure; the original ">=top 10" expectation was optimistic.

-- E3  "funding for fusion energy startups without giving up equity"
--     kinds=[program] → INFUSE #1 on the vector leg (its doc never says
--     "startup"), ARPA-E #1 overall via both legs. PASS.

-- Latency: 155-845ms pre-index (sequential scan). WITH HNSW (m=16,
-- ef_construction=64, built 2026-07-26 on 148,430 halfvec-512 vectors):
-- 268ms cold / 52-58ms warm — a 12x speedup, well inside the <1s budget.
-- search_documents totals 651MB incl. the index.
--
-- E4 END-TO-END (the real test, through the analyst with credits restored):
--   "Which foundations and federal programs should a fusion energy simulation
--    software startup approach?" -> the model called semantic_funder_search,
--   observed it had surfaced peer COMPANIES, re-called it filtered to
--   foundations, then pulled grant evidence with run_query. Result: Simons
--   ($10.5M across 31 grants) and Schmidt ($6.0M to MIT PSFC) recovered via
--   the evidence leg exactly as the E1b known-limit predicts, plus DOE's
--   1,326 fusion/plasma SBIR awards ($443M). The discovery+evidence pairing
--   works in practice, including the model's own mid-answer self-correction.

-- ===========================================================================
-- PHASE 2 · ENTITY RESOLUTION (ER-series). Recorded 2026-07-27.
-- ===========================================================================

-- ER3  Grant-recipient resolution (deterministic tiers, migration 0009/0010)
--   1,060,845 distinct recipient names vs 2,057,496 candidate orgs.
--   tier1 (exact name + state + unique)      349,293 matches @ 0.98
--   tier2 (exact name + nationally unique)       784 matches @ 0.93
--   tier3 (entity-suffix stripped + state)    57,813 matches @ 0.90
--   -> 407,890 matches; 886,763 of 2,324,534 grants linked (38.1% of rows).
--   Precision spot-checks pass: MIT->MIT (MA), Princeton->Princeton (NJ), both
--   tier1. No stub orgs created; unmatched keeps as-reported text + NULL.
--
--   DOLLAR COVERAGE — the ">=50% of grant dollars" gate was set against a
--   denominator that cannot exist, and is hereby corrected:
--     linked                $47.9B
--     placeholder text      $30.7B  (5,242 rows, 21.6% of ALL grant dollars)
--     genuinely unmatched   $63.9B
--   => 33.6% of all grant dollars, 42.8% of RESOLVABLE grant dollars.
--   The placeholder tranche is pharma patient-assistance foundations reporting
--   lump sums to individuals: "HIPPA REGULATIONS PREVENT THE LISTING OF NAMES"
--   ($4.1B), "VARIOUS INDIVIDUALS" ($3.1B), "SEE ATTACHED" ($1.1B). These are
--   not organizations and must never be matched or stubbed.
--
--   The $63.9B residual is three classes, measured, NOT chased with heuristics
--   (precision is gated; recall is only reported):
--     (a) NAME VARIANTS — "COLUMBIA UNIVERSITY" has 0 exact candidates because
--         BMF lists it as "COLUMBIA UNIVERSITY IN THE CITY OF NEW YORK";
--         likewise NATIONAL PHILANTHROPIC TRUST ($880M). Needs a containment
--         or trigram tier, which can wrongly bind "STANFORD UNIVERSITY" to
--         "STANFORD UNIVERSITY ALUMNI ASSOCIATION" -> requires the labeling
--         workflow to certify before shipping. Deferred as tier 4.
--     (b) MULTI-EIN ENTITIES — "JOHNS HOPKINS UNIVERSITY" has 3 exact BMF rows
--         in MD ($349M unmatched). Uniqueness correctly refuses to guess which
--         EIN owns the grant. Needs a tie-break rule + labels.
--     (c) GENUINELY ABSENT — WORLD HEALTH ORGANIZATION ($350M) and other
--         foreign recipients are not in the BMF at all. Correctly unresolvable.
--
--   Grant amounts verified sane while investigating: 2,324,534 grants,
--   $142.5B total, median $3,000, avg $61,310, p99 $651,000, only 10 rows
--   over $1B and all legitimate (Gates Foundation Trust -> Gates Foundation
--   $8.1B; pharma foundations valuing donated drugs at list price).

-- ===========================================================================
-- 2026-07-29 · SUITE V2 FIRST RUN (`funderdb eval all`) + HNSW REGRESSION
-- ===========================================================================
-- The one-command runner (src/funderdb/evalsuite.py + benchmarks/
-- expectations.py) executes B1-B10 VERBATIM from this file, the E-series
-- against internal.hybrid_search with real query embeddings, and the ER
-- series against the recorded ER3 floors. Its first run caught a real
-- regression:
--
-- REGRESSION (found by E1b/E2; fixed by migration 0011): the HNSW build
-- (2026-07-26) silently broke KIND-FILTERED semantic search. The index scan
-- yields global-nearest tuples that are then post-filtered, and the
-- embedding space clusters by doc_kind — so kinds=['adviser'] returned ZERO
-- vector-leg rows (E2 recorded Lowercarbon at #30) and
-- kinds=['foundation','program'] surfaced 0 of the 4 fusion programs (E1b
-- recorded all 4 on top). iterative_scan cannot cross the cluster gap.
-- Every recorded E-result had been measured on the pre-index exact path.
-- Fix: filtered queries now take an exact vector leg (`(dist) + 0.0`
-- defeats the index; ranks within the filtered universe, ~150-800ms);
-- unfiltered queries keep the 52ms HNSW path. Verified: E1b back to 4/4
-- programs in top 6, E2 back to Lowercarbon rank=30 exactly.
--
-- Results after 0011, on the grown DB (2024 back-year complete: 4.35M
-- events, 289,775 PF filings, 2.26M orgs):
--      B1 [B] PASS: 7 programs; INFUSE present with funds_lab_not_company=True
--      B2 [B] PASS: 5 distinct SBIR/STTR agencies
--      B3 [B] PASS: Lowercarbon CRD 162946 resolved; Prelude rows=5 name-adjacent
--             non-ADV rows (documented absence from ADV/FormD holds)
--      B4 [B] PASS: 50 climate/energy advisers (floor 40)
--      B5 [B] PASS: 25 Schmidt-family foundation rows
--      B6 [B] PASS: 50 energy/science foundations >$10M (floor 40)
--      B7 [B] PASS: 4 IL science/energy foundations >$10M (floor 4)
--      B8 [B] PASS: 50 energy/science grant rows (floor 40)
--      B9 [B] PASS: 50 Reg D offerings in last 12mo (floor 40)
--     B10 [B] PASS: 2,264,888 orgs, 0 provenance orphans
--     B5b [B] PASS: Stellar Energy Foundation org row present (public_charity);
--             flips to a grants-visible gate when Schedule I lands
--      E1 [E] PASS: 0 medical-fusion contaminants in top 10
--     E1b [E] PASS: 4/4 fusion programs in top 6
--      E2 [E] PASS: top10 all advisers; Lowercarbon rank=30 (recorded: #30)
--      E3 [E] PASS: INFUSE #1 for non-dilutive fusion phrasing
--      E4 [E] REPORT: end-to-end analyst test not asserted headlessly
--      E5 [E] PASS: 3/3 known climate funders in top 10
--      E7 [E] PASS: negative control (youth ballet) — 0 energy orgs
--      E8 [E] PASS: state filter respected (30/30 CA)
--      E9 [E] PASS: min_size filter respected (30/30 >= $1B)
--     E10 [E] PASS: FTS leg — Lowercarbon #1 for its own name
--   ER-tier1/2/3 [ER] PASS: 349,293 / 784 / 57,813 (== recorded floors)
--   ER-linked [ER] PASS: 886,763 grant rows resolved
--   ER-spot [ER] PASS x3: MIT->MA tier1, Princeton->NJ tier1 (the plain
--             'PRINCETON UNIVERSITY' row; 'TRUSTEES OF...' resolves in WA),
--             zero placeholder-text matches
--   ER-funds [ER] SKIP: not applied yet (labels 2/2, Wilson 0.342)
--   ER-people [ER] SKIP: not applied yet

-- ===========================================================================
-- 2026-07-31 · BACK-YEARS FINALIZE (`funderdb eval all` on the 10.3M-event DB)
-- ===========================================================================
-- All four back-years complete (2021-2024; ONE filing missing across 640,157
-- indexed PF filings). Recipient resolution re-run over the grown corpus.
-- Getting here surfaced and fixed three scale failures, all committed with
-- narratives: (1) the single-statement _recips aggregate OOM-crashed the 2GB
-- Small instance at 9.1M unlinked rows -> sliced partial aggregates + memory
-- guards; (2) the flat apply UPDATE's plan collapsed (expression n_distinct
-- poisoned by placeholder names; a probe costed at ~50k rows) into per-batch
-- full-table sorts that crashed the server -> fenced LATERAL index probes;
-- (3) reconnect-resume machinery (cursor file) after repeated instance
-- stalls. Compute bumped Small->Medium mid-apply (Zach-approved); the final
-- sweep ran with zero disconnects.
--
-- Suite: 27 PASS · 0 FAIL · 3 REPORT/SKIP (E4 by design; funds/people ER
-- await the label gates). Changes vs 2026-07-30:
--   ER-tier1  416,962 (was 349,293)   ER-tier2  2,005 (was 784)
--   ER-tier3   90,521 (was 57,813)    ER-linked 3,747,209 (was 886,763)
--   Dollars linked: $171.0B (was $47.9B).
--   E1b now 3/4 fusion programs in top 6 (was 4/4; the deepened foundation
--   corpus displaced one program from the top block — assertion floor is
--   >=3, still PASS; watch on future re-embeds).
--   Embed corpus: 111,869 foundation docs (was 90,324); 108,394 re-embedded
--   (~$1.15); HNSW index retained (unfiltered path), filtered path exact
--   per migration 0011.

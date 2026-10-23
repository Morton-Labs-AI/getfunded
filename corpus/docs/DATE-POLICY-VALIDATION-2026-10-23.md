# Date-event and conditional-policy validation — October 23, 2026

Implemented `program-context/v3` as an explicit experiment. It associates literal dates with local opening, receipt, deadline, review, announcement or project-start cues; parses explicit month ranges; and retains conditional policy assertions with their exact source spans. Unknown years, timezones, standing, identity and program scope remain unknown. Footer years do not supply missing deadline years. Existing role extraction is unchanged.

The fresh comparison improves date-event results and policy precision, but does not justify broad scaling or default promotion.

| Selected-reference measure | Existing v2 | Experimental v3 |
| --- | ---: | ---: |
| Date-event precision | 22/30 = 73.3% | 26/31 = 83.9% |
| Date-event recall | 22/31 = 71.0% | 26/31 = 83.9% |
| Policy precision | 35/50 = 70.0% | 35/47 = 74.5% |
| Policy recall | 35/55 = 63.6% | 35/55 = 63.6% |
| Explicit condition flags captured correctly | Field unavailable | 12/13 = 92.3% |
| Labelled source units retained | 62/75 = 82.7% | 60/75 = 80.0% |
| Pages retaining evidence | 33/40 | 33/40 |
| Local extraction wall time | 0.436 seconds | 0.478 seconds |

Condition references comprise five conditional and eight unconditional assertions. V3 captures four of five conditional assertions and all eight unconditional assertions; one invitation prerequisite is omitted. Twelve emitted flags match their references. This measures the labelled kind/condition flag, not full condition-text, program-scope or whole-page accuracy.

## Sample and measurement limits

Forty distinct organizations and saved pages were frozen before predictions: ten each selected by raw lexical date, conditional, general policy and other strata. They exclude 3,696 earlier reviewed organizations, 20,055 prior source URLs, 5,280 raw hashes and 1,783 explicitly inventoried prior normalized text hashes. The reference contains 75 selected units from 37 organizations; three inspected cases have no paragraph reference labels and remain unscored. Structured forms/guidelines and a law-firm publisher relationship remain explicit gaps. This is a challenge sample, not a representative population estimate or independent human adjudication. The same agent read sources and sealed labels before running either version.

The 31 date references represent 27 unique organization-case/date/event facts; repeated facts in nested source units remain separate reference observations. Organization, URL, raw and normalized-text duplicates are each zero. Running two versions does not create 80 organization reviews. No new websites, qualified funders, human reviews, applications or publications result. Forty partial local claim-review steps were recorded exactly once; they do not increment full-organization vetting or source-acquisition audits.

Sources were acquired earlier. Their observation dates remain attached; this run made no live website requests and establishes no new website-currentness claim. Publisher excerpts, raw content, labels and before-images stay private. All 377 emitted source-span checks match saved text exactly; this establishes citation integrity, not semantic correctness.

The original date scorer incorrectly charged parent-block dates outside a labelled child span. A separate corrected score restricts dates to literal mentions inside the reference unit. Original labels, predictions and score remain immutable; neither extractor was rerun or tuned. The table uses the corrected, identical scoring rule for both versions. Policy scores retain their selected-unit overlap scope and are not exhaustive whole-page precision.

## Remaining gaps and scaling decision

V3 still misses an LOI acceptance window and three deadline dates whose event meaning comes from a table/list heading. It also misses an invitation prerequisite expressed as receiving an invitation before submission. Policy recall is unchanged, and source-unit retention falls by two units. No changes were made after observing this holdout. Both this sample and the previous 60 program cases are now development material.

Next: add LOI acceptance-window cues, carry explicitly bounded table/header event context, and capture prerequisite invitation wording. Preserve actor, program and temporal scope, including closed portals, historical announcements and individual awards. Then freeze another disjoint sample with external semantic reference labels and measure invoiced operational cost before promoting or scaling. Do not substitute extracted dates for proof a funder is currently open.

## Cost

Paired extraction costs 9.8% more wall time in this one local run; these subsecond measurements are descriptive, not a production benchmark. Dedicated pipeline model API calls, web requests, Supabase calls and remote mutations are all zero. Agent engineering, source reading and evaluation are not free: the recorded session checkpoint contains 400,098 uncached input tokens, 6,770,176 cached input tokens and 23,547 output tokens, of which 8,627 are reasoning output. Cached input and reasoning output are subsets, not additional tokens. The receipt excludes later documentation, delivery and final response. Invoice dollars and dollars per organization are unavailable; this is not a production unit-cost estimate.

## Use and verification

Existing defaults remain unchanged. `program_as_of` still selects v2 unless `experimental_program_events=True`; the new flag requires an explicit as-of date. CLI experiment:

```sh
funderdb research program-evidence --source PRIVATE_CAMPAIGN --case PRIVATE_CASE.json \
  --as-of 2026-10-23 --experimental-events --out PRIVATE_PACKET.json
```

The direct CLI produced an awaiting-claim-review packet with one program page and `qualified=false`. Changed Python modules compiled. One focused escaped-bug regression was run directly and failed against v2, then passed against v3. The initial pytest invocation could not run because pytest is not installed; no installation or routine suite followed. No CI polling.

Supabase remained read-only with zero calls and zero mutations. Inventory remains 2,309,073 organizations with immutable SHA-256 `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`. Existing workers, tracker and paused heartbeat were unchanged; no outreach, deletion or automation was performed.

Private reproducibility, sealed labels, both predictions, original/corrected scoring, review receipts and cost receipt: `data/research/date-policy-fresh-2026-10-23/`. Exact continuation: `HANDOFF-COMPLETE.json` and `remaining-gaps.json` there. Pending application: `data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`, status `awaiting_separate_application`. This run adds analysis only, with a preserved local backlog before-image; no executable remote patch or fresh remote expected state exists. Any future application requires separately authorized exact remote readback.

Verified by: paired fresh-source extraction, direct experimental CLI and Python compilation. Tests: routine suites not run (weekly review policy); one focused escaped-bug regression run directly as described above.

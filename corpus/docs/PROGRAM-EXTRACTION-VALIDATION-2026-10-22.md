# Program-specific extraction and fresh validation — October 22, 2026

**Implemented a versioned, opt-in program-evidence extractor. Evidence retrieval improves substantially, but role/policy precision and date-event typing remain insufficient for automated qualification. Scaling and default promotion remain held.**

## What changed

New `programs.py` and `programs_v2.py` preserve the first candidate and corrected candidate separately. Integrity-checked pages are grouped by literal local heading candidates, with page-only unresolved scope as an explicit fallback. Program headings are candidates, not adjudicated program identities, and shared-domain legal entities are never merged. Multiple role components, policy clauses, date evidence and conflicts coexist rather than becoming one organization-wide role or application status.

The corrected path retains full eligible blocks instead of ranking only short grant-containing passages. This avoids splitting `p.m.` away from its deadline context, keeps negation with recipient restrictions, retains policy text even when it lacks the word grant, and keeps dated openings and closings alongside their literal source. Annual, numeric and relative dates are not silently assigned a year or timezone. Full explicit dates carry tentative event types, which remain pending review. Omitted evidence counts remain explicit. Navigation, footer, form, quotation and inert script/style exclusions stay in place.

`build_packet(..., program_as_of=<explicit date>)` adds the corrected private `program_evidence` field. Normal callers omit this argument, retain their existing text/identity versions and do not acquire program-evidence fields. No existing workers were restarted, requeued or switched to the new path. The candidate schema does not submit claims, change standing, admit qualified funders or publish source material.

The new local CLI is explicit and writes an immutable private artifact:

```sh
.venv/bin/python -m funderdb.cli research program-evidence   --source data/research/full-2026-10-17   --case data/research/<run>/cases/011.json   --as-of 2026-10-22   --out data/research/<run>/program-packet.json
```

The case file contains the frozen `target` and saved source `result`. Output must remain inside the private research directory. Existing source hashes, dates, publisher licensing and human/application gates remain intact. Extracted tags and conflicts are leads, never approved facts.

## Fresh design and reference limits

First freeze: **40 distinct organizations and 40 distinct saved pages**, excluding 3,636 prior manually researched organizations, 19,995 previously cited URLs and 5,220 known raw hashes. Selection was fixed hash order among funder-name website-funding leads; it was not selected using prediction outcomes. One page per organization, with zero raw, URL or normalized-text duplicates within the sample. This is a funder-focused challenge sample, not a random census sample.

Before running either predictor, the agent read and labelled **58 source units across 37 organizations**. Three additional cases lacked selected paragraph-level reference units; sparse or structured-list evidence was kept as a gap, not classified as no funding. Source references can include a parent community foundation, trustee site or operating affiliate; identity is not adjudicated by this extraction benchmark.

After the first evaluation, the 40 cases became development material. Version 1 results and hashes were preserved. Corrections were implemented before the second sample was read. A **separate 20-organization/20-page** hash-selected sample excludes the first sample's IDs, raw hashes and URLs as well as the prior manual exclusions. It also has zero repeated raw hashes, URLs and normalized texts. Forty reference units across 19 organizations were read and sealed before paired predictions; one structured-content case has no selected paragraph-level reference unit.

These are fresh validation cases from saved sources, **not fresh website observations**. Labels were written by the implementing agent. They cover selected source units, not every statement on a page. Results measure extraction against that same-agent source reference; they are not independent human semantic accuracy, legal identity precision, current-cycle verification or population yield. Neither set should be reused as a fresh holdout after this work.

## Results

The first 40-case candidate retained evidence overlapping **38/58 reference units**, compared with **6/58** in the existing short-passage path. It emitted 203 exact-span clauses. On those units, role precision/recall were 66.7%/27.3%, policy 77.3%/58.6% and date-event 61.5%/61.5%. Wider retrieval alone did not make the labels reliable. The original failure results were not overwritten.

On the separate 20 cases, the corrected version retained **30/40 reference units (75%)**, versus **6/40 (15%)** in the existing path. It emitted 148 exact-span blocks from 18/20 pages. Nine pages had at least one literal named-heading scope candidate; correctness of inferred program names was not separately adjudicated.

| Typed evidence, same fresh 20-case reference | Version 1 precision | Version 1 recall | Version 2 precision | Version 2 recall |
|---|---:|---:|---:|---:|
| Role leads | 71.4% (5/7) | 31.3% (5/16) | 66.7% (6/9) | 37.5% (6/16) |
| Policy leads | 65.0% (13/20) | 46.4% (13/28) | 70.4% (19/27) | 67.9% (19/28) |
| Date plus event type | 50.0% (2/4) | 50.0% (2/4) | **25.0% (1/4)** | **25.0% (1/4)** |

The four full-date reference events are a tiny denominator. Dates without the correct opening/deadline/review-event interpretation do not count as correct. Version 2 worsened that result: month-range starts/ends and “received by” deadlines remain important misses. A nominal 95% date-unit exact agreement would be misleading because most units contain no reference full-date event; it is not the result used for promotion.

Policy recall improves, but eight extra policy tags remain. Role recall remains low and precision falls slightly. Incoming versus outgoing awards, service-recipient aid and conditional invitation requirements still need work. In particular, generic application-route language must not override an explicitly restricted or paused pathway. These findings preclude default promotion and qualification scaling.

**Yield:** 18/20 pages produce program-context retrieval output and 30/40 reviewed units are retained; these are extraction-yield measures only. There are **zero new discovered domains, current qualified funders, applied changes, human approvals or publications**. The samples include historical awards and expired/future calls, so output presence cannot establish a current opportunity. Whole-site last-updated month and exact recent paid-donation dates remain unestablished.

## Cost

Paired extraction on the final 20 saved pages took 0.142 seconds for the existing short-passage path, 0.195 seconds for version 1 and 0.220 seconds for version 2. Corrected extraction costs approximately **55.3% more wall time** than the old short-passage path, or 13.1% more than version 1. These subsecond measurements are one local pass, not a production latency guarantee. On the first 40 pages, old/version1 times were 0.311/0.419 seconds.

The own-session checkpoint at 02:14:50 UTC on October 23 (October 22 locally) records 6,847,337 input tokens, including 6,540,160 cached input (**307,177 uncached input**), plus **26,978 output tokens**, including 11,158 reasoning tokens. Subsets are not added again. This covers implementation, reference reading and evaluation through the checkpoint; later reporting/delivery/final response are excluded. It is not a steady-state per-organization cost. **Invoice dollars and dollars per useful result are unavailable.**

The extractor itself made zero model API calls, zero web requests and zero Supabase calls/mutations. Existing native sources were reused without refreshing their observation dates. No cheaper-model comparison was run, and agent work was not free.

## Duplicates, counters and source retention

Across both sets: **60 distinct organizations, 60 distinct raw snapshots, 60 distinct URLs and 60 distinct normalized texts**; duplicate counts are zero. The two sets are disjoint from each other. The same final 20 inputs were intentionally processed by both version 1 and version 2; these are paired evaluations, not 20 additional organizations. The 98 labelled source units, 203 first-pass clauses and 148 corrected-pass blocks are different evidence units, not organization counts.

Sixty actual bounded source-review steps were recorded once, each with source hashes, observation dates and reference provenance. Four cases remain explicitly unscored at paragraph-reference level. These steps add no acquisition, bulk source-audit coverage or qualified-funder admissions. The original 2,309,073 inventory/hash is preserved. Classification-ledger role counts and another worktree's semantic-review counts were not combined with this partial source-extraction benchmark.

Exact private runs:

- `data/research/program-extraction-fresh-2026-10-22/`: initial frozen40, labels/hash, version1 predictions, retained failure report and review receipts.
- `data/research/program-extraction-fresh2-2026-10-22/`: disjoint final20, labels/hash, paired version1/version2 predictions, CLI example, review receipts, cost receipt, unresolved gap queue and complete handoff.

Raw snapshots, publisher text, detailed per-case labels, searches/access configuration and contact information remain private. Public changes contain implementation and original aggregate analysis only. The active-funder `APPLICATION-BACKLOG.json` has an analysis-only pointer with its previous bytes/hash retained. No executable database patches or new remote before-images were created. Live application requires a separately requested exact readback/expected-state step; it is not a dependency for continuing research.

## Next exact development gate

Keep all program extraction opt-in. Use the now-reviewed 60 cases as development evidence for clause-level negation/actor attribution, conditional invitations, program boundaries, and a date parser that distinguishes review meetings, opening dates, “received by” deadlines and range endpoints. Do not tune reported fresh results or relabel failures to increase accuracy. The four-date final sample does not justify a date-accuracy claim.

Then freeze a separate date-focused and program-scope reference with enough positive and negative examples, including annual/relative dates and multiple legal entities. Obtain independent reference labels before using semantic accuracy as a promotion gate. Reconcile exact-date/event precision and recall, false-open calls and named-scope correctness before scaling; use invoice receipts for marginal-cost claims. Existing conservative identity gates and the read-only research/application separation remain mandatory.

Verified by: the requested frozen40 and disjoint20 paired evaluations, 351 exact source-span checks, 60 canonical review receipts each present once, the new `program-evidence` CLI on a frozen case, and Python compilation of the four changed modules. Tests: not run (weekly review policy).

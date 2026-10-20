# Missing-website discovery pilot: 1,000 organizations

October 20, 2026. Original research and implementation: Codex. Human data review and publication approval remain pending.

**Later extractor followup:** [the separate 40-page evaluation](EIN-EXTRACTOR-VALIDATION-2026-10-20.md) fixes the three known misses while preserving legacy citations. The pilot counts below remain the original dated discovery result; no additional websites were discovered.

The bounded discovery pass is complete. It produced **four source-supported website identity bridges with fresh, hash-checked HTTP 200 evidence: a 0.4% yield**. The other 996 organizations remain unresolved by this method; this does not establish that they lack websites. **Do not scale this approach yet.** The pilot found specific extraction failures and an unproductive followup-search pattern that should be corrected first.

## Cohort and recency

The frozen cohort contains 1,000 distinct organization IDs and 1,000 distinct EINs. Selection started with 1,500 previously unsearched, missing-site private foundations classified T20/T22 and supported by saved IRS subsection 03 observations. Public outgoing-grant records then determined recency priority, with UUID as the tie-breaker. The selected cohort has four organizations with fiscal-year 2026 grant records, 516 with 2025 records and 480 with 2024 records.

This is a convenience cohort, not a representative sample of all missing-site nonprofits. The 30 GET-only grant queries returned 18,978 distinct grant IDs across the 1,500 screened candidates. One response reached its 1,000-row cap, so the observations are not a complete grant census. None of these records has a precise event date. **No donation in the past 12 months was confirmed from fiscal-year labels alone.** Assets and historical awards were not used to predict interest in an applicant.

Cohort SHA-256: `e25bedfd02b2c9702f7231425650876b1c5fd7c282ffa5730fc2f84fbea6c412`.
The full 2,309,073-organization inventory and its immutable hash remain unchanged.

## Results

| Measure | Result | Meaning |
|---|---:|---|
| Initial queries actually executed | 1,000 | One registry-name/locality query per organization; all distinct |
| Targeted EIN/domain followup queries | 92 | No allowed candidate-host hits returned; not proof of absence |
| Registered research records | 1,100 | 1,092 search steps and eight bounded identity reviews across 1,000 organizations |
| Selected source-open operations | 196 | 149 returned body representations; 47 failed or inaccessible; not full semantic reviews |
| Source-supported live identity bridges | 4 | Exact primary self-identification matched the frozen EIN and legal entity |
| Native crawler evidence | 10 pages | Four organizations, 12 page attempts, two errors; source hashes checked |
| Historical registry bridge held | 1 | Dated government mapping; current original-document access unresolved |
| Local pool additions | 4 | Candidate admission, not verified-funder qualification |
| Strict local preparations | 4 | Four literal claims with matching preserved source spans |
| Qualified / applied / human-reviewed / published profile additions | 0 / 0 / 0 / 0 | Software or research completion does not approve data |

The four useful cases are:

- [McCreight Foundation of Virginia](https://www.mccreightfoundationvirginia.org/donate): the native source identifies the exact EIN and explicitly offers an unsolicited-proposal form. Its discussion of earlier school support is historical background, not current applicant eligibility or evidence of interest in a new applicant. The form was not submitted or tested.
- [Fairhope Rotary Club Foundation](https://fairhoperotary.org/1633-2/): the source identifies the exact EIN and distinguishes the legally independent local foundation from the club and Rotary International. Funding requests must begin in writing through the local club, which may choose among several funding routes. This is not a direct foundation application or a guaranteed award.
- [Liao & Zhou Foundation](https://liaozhoufoundation.github.io/): the source identifies the exact EIN and Fremont headquarters, describes charitable focus areas and states a public-charity preference. General contact information does not establish unsolicited grant permission or an open cycle.
- [Ashley Hope Foundation](https://www.theashleyhopefoundation.org/): the native source identifies the exact EIN and describes the foundation's mission. General contact, old event labels and a copyright year do not establish grant eligibility, a current call or a whole-site update date.

Whole-site update month and current IRS standing remain unknown for all four. Fresh page acquisition establishes observed liveness, not currentness of every statement. All program interpretations remain staged.

## Accuracy findings and unresolved evidence

The existing automated EIN detector recognized **one of the four manually supported native bridges**. The other three were missed because of “EIN is” wording, a question-form tax-ID label, or DOM text concatenating an EIN with following footer text. The 25% detection rate describes this selected four-case subset only. It is not population recall or overall model accuracy. Preserve the old extractor and citation vintages when implementing a correction.

Three primary-source alternatives were rejected because their EINs differed from the target organizations: Rowan, Abraham and Provision. Two other exact-EIN hits were directory pages, which were not accepted as official funder websites. These checks demonstrate concrete error controls; they do not establish a population precision estimate. No independently labelled representative reference set or human review was completed.

A cached [2017 Washington state directory](https://www.give.wa.gov/_assets/charities/trustdirectory.pdf) maps Ellison Foundation's exact EIN to the hyphenated domain. The original document URL currently redirects to a 404 route; a bounded download returned HTML rather than a PDF. The historical bridge remains held. Its old contact, grant amounts and application terms were not promoted to current facts. No alternate client was used to bypass that outcome.

The result-header parser was refined during the pilot. The final metadata-qualified extraction found 14,187 URL observations, superseding the earlier 11,693 block count. Thirty additional domain leads were retained; 24 additional opens added no accepted native identity bridge. This evolving extraction method is another reason not to present the pilot as a held-out accuracy evaluation.

## Cost and duplicates

The measured workload was 1,092 pilot search queries, 196 selected source-open operations and 31 successful Supabase GET query responses: 30 for grant prioritization and one for exact organization before-images. The existing GET client can retry transient failures; retry attempts were not separately instrumented. A calibration search outside the cohort and documentation/registry-access operations are recorded as overhead, not additional pilot organizations.

That is **273 pilot search queries per supported live identity bridge**, before source-open and verification work. Actual own-chat token-counter differences and wall time are retained in the private cost receipt, with cached input, uncached input and output separated. Reasoning output is a subset of output, not an extra amount. Billed dollars, plan allocation and applicable rates are not exposed; no zero-dollar or speculative price claim is made.

Duplicate counts use separate denominators:

- Cohort: 1,000 records, 1,000 IDs, 1,000 EINs, zero duplicate members.
- Initial queries/responses: 1,000 distinct queries and 1,000 response hashes. The 92 followups are extra research records on existing members.
- Result URLs: 14,187 observations, 13,549 distinct literal URLs and 638 repetitions. These are not distinct verified facts.
- Source opens: 196 operations, 195 distinct requested URLs and one repeated URL request.
- Proposals: four records, four input hashes, zero identical-input repetitions; four claim observations, four organization-scoped literal keys and zero repetitions.

The four manually enriched cards sit within 1,000 private card projections; one projection revision preserves the distinction between historical school support and current fit. Card generation adds no research, audit or qualification count. Earlier campaign duplicate snapshots were not recomputed or silently extended.

## Application gates and next step

Supabase received **GET requests only and zero mutations**. Four proposed URL changes retain fresh exact organization before-images, local queue before-images and source hashes. Program/signal table states were not read; exact table-specific readback remains required in a separately requested application session. All candidates remain `awaiting_separate_application`, with identity/current-standing, scope/cycle, licensing, duplicate/supersession and human gates. Raw500–508, ledger562 and earlier cancelled work were untouched.

The existing guarded crawler handled the four candidates with its original 16-worker, six-page, host-pacing, robots/TLS/public-IP/body-size and 10GiB disk protections. No competing crawler, automation, outreach or subagent was created. Four newly acquired source pairs do not complete waves0030/0031 or advance the requested 20,000-source-audit bar.

**Recommended next:** fix and version the EIN-label and DOM-boundary extraction gaps using the preserved examples, then independently label a small stratified sample of positive, ambiguous and no-lead cases. Prefer filing/official-registry domain bridges, retaining their dates and access limitations. Measure supported-domain yield and cost again before expanding discovery. Do not repeat the unproductive 92-query pattern automatically.

Private results, cost receipt, cards and exact handoff: `corpus/data/research/missing-website-pilot-1000-2026-10-20/` (`pilot-results.json`, `cost-receipt.json`, `HANDOFF-COMPLETE.json`).
Pending application: `corpus/data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`.
Raw bodies, publisher excerpts, searches/results, contacts, before-images and access configuration remain private.

Verified by: frozen 1,000-member cohort hash, 1,100 canonical research-record hashes, ten native source pages, four strict preparations and their before-images. Tests: not run (weekly review policy).

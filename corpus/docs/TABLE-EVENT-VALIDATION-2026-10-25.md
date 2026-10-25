# Table-cell attribution and event exclusions — October 25, 2026

Implemented a bounded row/column grid, literal header citations and event exclusions in explicit experimental versions. The two previous source cases now match all14 labelled date events, including merged deadline columns and webinar/notification/performance exclusions. Those are development checks, separate from fresh accuracy.

On a disjoint final26-case sample, v7 improves date-event precision and recall to93.8%. Two date errors, weak policy/condition recall, higher local cost and the lack of external semantic labels keep default promotion and scaling held. Ordinary packets, program-as-of v2, and the existing experimental v3 default remain unchanged; v6/v7 require explicit version selection.

| Final26 selected-reference measure | Retained v3 | Prior experiment v5 | New v7 |
| --- | ---: | ---: | ---: |
| Date-event precision | 18/22 = 81.8% | 26/32 = 81.3% | 30/32 = 93.8% |
| Date-event recall | 18/32 = 56.3% | 26/32 = 81.3% | 30/32 = 93.8% |
| Policy precision | 22/28 = 78.6% | 22/28 = 78.6% | 22/28 = 78.6% |
| Policy recall | 22/47 = 46.8% | 22/47 = 46.8% | 22/47 = 46.8% |
| Correct condition references captured | 6/14 | 6/14 | 6/14 |
| Labelled evidence units retained | 50/74 = 67.6% | 60/74 = 81.1% | 59/74 = 79.7% |
| Pages retaining evidence | 26/26 | 26/26 | 26/26 |
| Local extraction time | 0.392 seconds | 0.478 seconds | 0.825 seconds |

The primary20 general cases have eight labelled date events, all correct in each version. The six targeted cases include three native table publishers and three event-control sources: date precision/recall improves75.0%→91.7% versus v5; retained units27/30 remain unchanged. General-case retention falls33/44→32/44. More emitted blocks or exact citations do not automatically mean greater semantic yield.

## Changes and scope

`program_tables` builds a maximum200-row,64-column grid from literal colspan/rowspan values. It rejects invalid, overlapping, oversized and nested grids rather than guessing. Header IDs, column headers and row labels are resolved within the same table. The nearest specific applicable header is cited; conflicting header kinds remain unknown. Literal row subjects and row/column positions are retained without treating them as the page owner's legal identity or granting program approval.

A separate DOM-to-text map cites the actual occurrence of repeated header and cell text. It must reproduce the saved normalized text exactly. Source spans, hashes and DOM locators remain attached to both date evidence and inherited context. Scripts/inert markup are handled consistently with the existing source reader. Earlier text/extractor hashes and versions are retained.

Explicit webinar, interview, notification, review and project-performance cues take precedence over broad deadline headings. Header vocabulary also distinguishes application windows, available/open dates, due dates, evaluation/offer dates, recipient follow-up and acceptance dates. Explicit ranges beneath an application-window header yield opening/deadline endpoints. A single window date stays unresolved. Unknown years, timezones, entity/program scope and current standing remain unknown; a past deadline is not proof that a whole funder is closed.

No role or policy rule expansion is claimed. Policy assertions retain v5 behavior; their low recall and condition gaps remain visible. New extraction is available through `--experimental-events --events-version v7` or `build_packet(..., experimental_program_events=True, program_events_version="v7", program_as_of=...)`. Existing workers were not reloaded.

## Freshness, failures and measurement limits

The final20 sample excludes3,832 earlier reviewed/selected organizations,20,191 source URLs,5,416 raw hashes and1,919 explicitly inventoried normalized-text hashes. Its fixed lexical strata contain five each of date, conditional, general policy and other pages. The separate targeted six exclude these20 as well, and use raw table/event criteria without extractor predictions. Sources are previously acquired pages: original observation dates are preserved, with no fresh HTTP or new website-currentness assertion.

The final reference has74 selected units across23 organizations,32 date references representing28 unique case/date/event facts, and14 condition references. Three inspected cases have no selected reference units; they are not evidence of absent grantmaking. Reference labels were authored by the same agent and sealed before each prediction run. These enriched, small samples do not establish independent human or population accuracy, complete program terms, fit, or inquiry readiness. Condition scores cover explicitly labelled kind/boolean flags, not complete condition-text correctness.

Two final date errors remain. A volunteer committee-nomination deadline is treated as a grant deadline. A real full-proposal deadline qualified by “by invitation” is treated as an invitation-notification date. These show that actor scope and eligibility qualifiers need more precise handling. No code changes followed the final holdout. The three fresh native table pages use simple grids; fresh native merged-cell validation is still missing. Merged spans are covered by prior source development cases and the focused synthetic regression, not a fresh native merged-cell accuracy claim.

The initial26-case v6 iteration is retained separately. It exposed missing “Due,” “Available,” evaluation/recipient and application-window header vocabulary. Its targeted date result18/31 correct led to development changes before the disjoint final sample. One initial general-case reference omitted a literal2024 news date; a source-backed erratum and separate corrected date score are retained without replacing sealed labels, changing predictors or rerunning outputs. Final26 results are unaffected. Both completed samples are now development material.

## Counts and cost

Across both iterations,52 distinct organizations/pages received actual bounded source reviews, recorded exactly once in the local research-step ledger. Organization, URL, raw-hash and normalized-text duplicates are each zero. Three-version comparisons reuse the same cases; two old development rechecks are separate and add no new review records. There are166 sealed reference units,77 sealed date references plus one initial reference erratum, and31 condition references. The ledger/classification coverage is not advanced by generated selection matches, acquired pages, repeated dates or partial extraction reviews.

All1,129 emitted source spans and30 inherited context spans match their saved source text;17 final row-subject citations were also checked. These are citation-integrity counts, not audited-organization counts or semantic approvals. Detailed labels, publisher excerpts, raw sources and before-images remain private, with publication and human-review gates pending. No new domains, full-organization coverage audits, qualified funders, human-reviewed organizations, applied database changes or published organizations were added.

Final26 extraction costs72.8% more wall time than v5 and110.5% more than retained v3. The subsecond single-run timings are descriptive, not a production benchmark. Exact DOM occurrence mapping adds work and should be optimized only with citation invariants retained. Pipeline model API calls, new web requests, Supabase calls and remote mutations are all zero. Agent engineering/reference work has a separate token cost: the saved checkpoint records62,114 uncached input tokens,6,252,544 cached input tokens and34,764 output tokens;15,685 reasoning tokens are an output subset. Later reporting/delivery is excluded. Invoice dollars and production dollars per organization remain unavailable.

Supabase stayed read-only. The inventory remains2,309,073 organizations, immutable SHA-256 `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`. Existing crawler/tracker processes and the paused heartbeat were unchanged. No outreach, automation, deletion, main push or merge was performed.

## Verification and continuation

The explicit v7 CLI produced an awaiting-claim-review packet with one program page and `qualified=false`. Changed Python modules compiled. One focused escaped-bug regression function was run directly through red/green iterations, first for merged headers/event exclusions and then for due/window/recipient header forms. Routine suites and CI polling were not run under the weekly policy.

Next: distinguish eligibility-conditioned proposal deadlines from notification events, and distinguish volunteer/donor/staff activity from grant applications. Then address prose/list schedules, implicit reopening and incomplete policy forms. Optimize DOM span work while preserving exact occurrence citations. Before promotion, freeze another disjoint sample including a fresh merged-cell native publisher, obtain external semantic reference labels, and measure invoiced operational cost. Do not retune these completed references and call the result fresh accuracy.

Private exact continuation: `data/research/table-events-fresh2-2026-10-25/HANDOFF-COMPLETE.json`, alongside `remaining-gaps.json`, sealed references, all three predictions, evaluations, review receipts and cost receipt. Initial26 retained in `data/research/table-events-fresh-2026-10-25/`. Do not replay52 review steps or earlier70/40/60 batches.

Pending application remains `data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`, status `awaiting_separate_application`. An analysis-only pointer was added after preserving exact prior bytes/hash. No executable remote patch or fresh remote expected state was prepared; future application requires a separately authorized exact readback.

Verified by: requested three-version source evaluation, exact citation/receipt checks, direct explicit-version CLI and Python compilation. Tests: routine suites not run (weekly review policy); one focused escaped-bug regression run directly as described above.

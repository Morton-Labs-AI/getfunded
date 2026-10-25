# LOI windows, heading deadlines and invitation prerequisites — October 25, 2026

The three previously identified source failures are corrected in versioned experimental code: an explicit LOI acceptance window yields opening/deadline endpoints; a deadline list can cite its nearby heading; and receiving an invitation before submitting is retained as a conditional prerequisite. Direct checks on the three old cases confirm those bounded corrections. They are development evidence, not fresh accuracy results.

Fresh native-source validation rejects promotion. More source text is retained, but date-event accuracy worsens on structural cases. Existing behavior remains the default: ordinary packets are unchanged, `program_as_of` selects v2, and `--experimental-events` still selects v3. New v4/v5 require a separate explicit version selection. No scaling or qualification is enabled.

## Fresh validation

The final v5 evaluation uses 20 previously unreviewed organizations plus two lexical controls and two structural challenge organizations. These 24 organizations are disjoint from the first 46-case iteration and earlier research exclusions. Selection, source hashes, code hashes and references were sealed before each prediction run. No extractor changes followed the final holdout.

| Final 24-case selected-reference measure | Existing v3 | Experimental v5 |
| --- | ---: | ---: |
| Date-event precision | 12/13 = 92.3% | 10/20 = 50.0% |
| Date-event recall | 12/29 = 41.4% | 10/29 = 34.5% |
| Policy precision | 19/26 = 73.1% | 19/26 = 73.1% |
| Policy recall | 19/34 = 55.9% | 19/34 = 55.9% |
| Correct condition references captured | 11/14 = 78.6% | 11/14 = 78.6% |
| Labelled source units retained | 38/66 = 57.6% | 45/66 = 68.2% |
| Pages retaining evidence | 20/24 | 20/24 |
| Paired local extraction time | 0.378 seconds | 0.389 seconds |

Keep the strata visible: the primary 20-case sample has unchanged date precision100% on six extracted references and recall6/12; policy precision72.7%, recall57.1%; retention29/45. The two lexical controls add three missed date references in excluded structural content. The two native structural cases expose the regression: date precision85.7%→28.6%, recall42.9%→28.6%, while retention8/19→15/19. These small, deliberately enriched strata are not population estimates.

The final references contain 66 units across22 organizations, 29 date-event references representing28 unique case/date/event facts, and14 condition references. Two inspected cases have no selected reference units. Condition scoring measures the explicitly labelled kind/boolean flag, not complete condition-text or entity/program scope. The same agent authored references before predictions; no independent human accuracy claim is made.

## What changed, and what failed

V4 adds explicit LOI acceptance-range cues, source-cited section/column context, short date-only blocks and invitation prerequisites. Version5 additionally recognizes a short emphasized paragraph used as a deadline heading. Context has its own exact source span and source hashes; it is not silently prepended to a date excerpt. Local event cues and second dates in list rows take precedence. Unsupported merged table cells are held rather than assigned by guessed column position. Years, timezones, whole-site update dates and funder standing are not invented. Role extraction remains unchanged.

The first 40-case sample showed no improvement on its selected references. A six-case supplemental sample exposed the emphasized-heading failure: date precision87.5%→71.4%, recall73.7%→78.9%, with four recovered short date rows still misclassified. These 46 cases became development material before v5; their original code, references, outputs and evaluation remain retained. They are excluded from the final 24-case metrics.

The final native structural sample contains a publisher page with seven HTML tables, including a deadline header spanning four columns. The conservative v5 column lookup does not resolve that merged header: seven date rows across the page remain incorrectly typed as other dates. Another source's “Deadlines” section includes an informational webinar and an invitation notification; v5 incorrectly inherits deadline meaning for those two dates. A project-performance date is also misclassified by the existing local cue rules. This is why improved text yield is not sufficient for promotion.

Known LOI-window and explicit invitation-prerequisite wording is checked in prior source cases and the focused regression. The fresh samples contain broader LOI approval/reapplication conditions that remain missed; they do not independently establish recall for the new exact window/prerequisite patterns. A lexical search for unseen explicit receive-invitation-before-submission examples found none in the eligible saved source pool. Its requested quota was three; actual availability was zero. Generated matches and pages scanned for selection do not count as completed research.

## Counts, provenance and cost

Across both iterations, 70 distinct organizations/pages were actually read in bounded source reviews, with176 selected units,64 date references and32 condition references. Seventy canonical local claim-review steps were recorded exactly once. There are zero organization, URL, raw-hash and normalized-text duplicates across the samples. Paired extractor runs reuse the same organizations; three prior-case development rechecks are separate and add no new review records. Seven inspected cases have no reference units; this is not evidence of absent funding.

All866 emitted source spans and two inherited context spans match their saved source text. Citation integrity does not establish event correctness. Sources retain their original observation dates: this session acquired no live pages and makes no new currentness claim. Publisher excerpts, detailed source labels, snapshots and before-images remain private. Legal entity, program/actor scope, licensing, human-review and publication gates remain pending. No new coverage audits, websites, qualified funders, human-reviewed organizations, applied changes or publications were added.

Final24 local extraction time rises about3.0%; primary20 alone rises2.7%. These subsecond, single-run measurements are descriptive. Dedicated model API calls, new web requests and Supabase calls/mutations are zero. Agent engineering/reference work is not free: the recorded checkpoint contains125,309 uncached input tokens,4,682,240 cached input tokens and29,835 output tokens, including10,393 reasoning tokens as an output subset. Later reporting/delivery is excluded. Invoice dollars and production dollars per organization are unavailable.

The immutable inventory remains2,309,073 organizations, SHA-256 `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`. Workers, tracker and paused heartbeat were unchanged. No Supabase operations, outreach, automation, deletions, main push or merge were performed.

## Review and continuation

Explicit experimental usage:

```sh
funderdb research program-evidence --source PRIVATE_CAMPAIGN --case PRIVATE_CASE.json \
  --as-of 2026-10-25 --experimental-events --events-version v5 --out PRIVATE_PACKET.json
```

The direct invocation produced an awaiting-claim-review packet with one program page and `qualified=false`. Changed Python modules compiled. One escaped-bug regression function was run directly through red/green iterations: initial v3 failure, v4 pass for a normal heading, then v4 failure/v5 pass for an emphasized heading. No routine test suite or CI polling was performed. A validation-script hash guard initially stopped before predictions because it named v4 rather than v5; that harness path was corrected, leaving labels and extractors unchanged.

Next exact steps: build an explicit table cell grid with bounded colspan/rowspan header attribution; exclude webinar, notification and performance events from inherited application-deadline labels; represent unresolved event types explicitly; then address LOI-approval/reapplication paraphrases and malformed concatenated date boundaries. Acquire fresh native window/prerequisite examples and freeze a disjoint sample with external semantic labels and invoiced operational cost before promotion. Both completed iterations are now development material; do not tune them and call the result fresh accuracy.

Private artifacts: `data/research/loi-prerequisite-fresh-2026-10-25/` (first46) and `data/research/loi-prerequisite-fresh2-2026-10-25/` (final24). Exact continuation is the latter `HANDOFF-COMPLETE.json`, with `remaining-gaps.json`, sealed references, all predictions/evaluations, review receipts and cost receipt. Do not replay70 review steps or the earlier40/60 steps.

Pending application remains `data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`, status `awaiting_separate_application`. Its exact prior bytes/hash were retained before adding an analysis-only pointer. No executable remote patch or fresh remote expected state was prepared; future application requires a separately authorized exact readback.

Verified by: paired fresh source evaluations, exact citation checks, direct explicit-version CLI and Python compilation. Tests: routine suites not run (weekly review policy); one focused escaped-bug regression run directly as described above.

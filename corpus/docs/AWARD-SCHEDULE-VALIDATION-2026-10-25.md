# Award scope and nested schedules — October 25, 2026

Explicit experimental v10 corrects recognition-submission scope and bounded nested heading attribution. Two saved development pages confirm five corrected event classifications: three grant deadlines and two recognition submissions; meeting dates and a cash research-award deadline stay separate. Fresh28 confirms one additional nested-deadline correction. Overall date precision improves84.7%→86.4% and recall78.1%→79.7%; evidence yield is unchanged. Promotion and scaling remain held.

| Selected-reference measure | Prior v9 | New v10 |
| --- | ---: | ---: |
| Primary20 precision / recall | 78.1% /69.4% | 78.1% /69.4% |
| Broad lexical4 precision / recall | 100% /100% | 100% /100% |
| Direct4 precision / recall | 81.8% /75.0% | 90.9% /83.3% |
| Combined date precision | 50/59 =84.7% | 51/59 =86.4% |
| Combined date recall | 50/64 =78.1% | 51/64 =79.7% |
| Labelled units retained | 74/106 =69.8% | 74/106 =69.8% |
| Pages retaining evidence | 24/28 | 24/28 |
| Local extraction wall time | 1.468 seconds | 1.500 seconds |

## Implementation and boundaries

Recognition-submission classification requires explicit award, submission and recognition/nomination language within one short source unit containing one date. This allows a recognition description after the date to inform scope. Explicit cash, grant, scholarship and other funding language holds that inference. A narrow scholarly-achievement-list use of “scholarship” is not treated as a monetary award by itself. The original source is unchanged; exact award and recognition cue spans are retained with monetary and entity scope unapproved. Nominations can concern monetary awards and remain distinct from direct applications. Absence of a dollar amount alone never proves an award is honorific.

Nested schedule attribution includes h5/h6 labels and wrappers containing one exact label. It evaluates up to eight preceding siblings at each of six ancestor levels. Date-only siblings can be traversed; unrelated prose, unknown headings, multiple labels and complete neighboring schedules stop inheritance. The inherited heading is cited exactly. Native table geometry and previous source-occurrence mapping are reused unchanged. Committee/trustee dates remain separate from grant deadlines; legal identity and eligibility are not approved by layout.

Ordinary packets, `program_as_of` v2 and experimental defaultv3 remain unchanged. V10 requires explicit `--experimental-events --events-version v10` or the matching packet argument. Prior modules, frozen references and failed outputs are retained. No worker reload or automatic qualification/application was enabled.

## Fresh sample and accuracy limits

The primary20 has fixed lexical quotas:3 award,3 schedule,6 dates,4 conditional,4 other. It excludes3,910 prior reviewed/selected organizations,20,269 URLs,5,494 raw hashes and1,997 inventoried normalized-text hashes. A disjoint four-case broad DOM/lexical set and a further four-case direct-phrase/date-only set are retained separately. Each set has source/code hashes and same-agent labels sealed before paired predictions. Implementation was unchanged throughout all holdouts.

The primary20 and broad4 show no gain. The broad matches include award news and application windows both versions already handle. Direct4 adds one correct nested application deadline while preserving trustee-review dates. Portal-opening interpretation and a cash school-award date lost through custom markup remain unresolved. Direct award matches include a nomination and a monetary award; they do not independently establish accuracy for fresh recognition-only submissions whose recognition description follows the date. The latter correction currently has development-source and focused-regression support only.

Across28 organizations,106 actually-read selected units contain64 date references and57 unique `(case,date,event)` keys. Seven shared keys are counted separately; different programs/people can share a date, so they are not automatically duplicate real-world events. Repeated paragraph/context copies omitted from scoring remain retained privately. Organization, URL, raw-hash and normalized-text duplicate counts are each zero. Paired versions and the two old development rechecks do not add organizations.

Eight extra and13 missed event references remain in v10. Gaps include cycle-only headings, colon/post-date application labels, grant-disbursement versus opening dates, an interview that is an actual alternative application format, concatenated news dates, generic portal-opening labels and custom markup. Policy/condition extraction was unchanged and not scored in this date-focused validation. Same-agent selected-reference accuracy is not external human, whole-page, current-cycle or population accuracy. Scores from earlier batches use different sources and denominators.

Literal historical years, generic versus program-specific cycle wording, school-year/award-year inconsistencies, and current news with historical related-event links remain explicit. Partial years are not assigned automatically. Parent charity/foundation and foundation/administrator relationships remain unapproved. Historical awards, investment values and a live saved URL do not establish current funding interest or inquiry eligibility.

## Yield, cost and continuation

Twenty-eight bounded source readings were recorded exactly once in local research_steps. New full-organization audits, websites, qualified funders, human-reviewed records, database applications and publications are all zero. All890 emitted evidence spans,548 date literals,38 inherited contexts,2 subject-role spans and2 award-cue spans across both versions match saved text. Citation integrity is not semantic approval. Raw pages, excerpts, labels, hashes, access information and before-images remain private.

Saved observations date from October17–20; no new live website/currentness checks were made. Pipeline model API calls, new HTTP requests and Supabase calls/mutations are zero. One ordered run measured1.468s→1.500s, about2.2% more wall time; cache/order effects are uncontrolled, so this is not a demonstrated optimization. Agent engineering/reference work is separate: the saved checkpoint records31,166 uncached input tokens,3,973,760 cached input tokens and23,824 output tokens;10,510 reasoning tokens are an output subset. Later reporting/delivery is excluded. Invoice dollars and production cost per organization remain unknown; no cost-effective scaling claim is made.

The inventory remains2,309,073 organizations, SHA-256 `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`. Workers/tracker and paused heartbeat were unchanged. No outreach, deletion, automation, merge, main push or CI polling occurred.

Next: bind portal and post-date labels to explicit application events, distinguish disbursement and application-interview scope, and improve cycle/custom-markup retention on development sources. Obtain untouched recognition-only submission and ambiguous-heading sources, external semantic labels and measured operational invoices before promotion. These28 cases are now development material; do not relabel or replay them as fresh research.

Exact private continuation: `data/research/award-schedule-fresh-2026-10-25/HANDOFF-COMPLETE.json`; primary20/broad4/direct4 evaluations and development failures remain separate. Pending application: `data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`, `awaiting_separate_application`. Exact prior bytes/hash were preserved before adding an analysis-only pointer. No executable remote patch or fresh remote expected state was prepared; live application requires a separately requested session and exact readback.

Verified by: requested frozen paired source evaluations, exact citation/once-only receipt checks, explicitv10 CLI and changed-module compilation. Tests: routine suites not run (weekly review policy); one focused escaped-bug regression failed againstv9 and passed againstv10 directly.

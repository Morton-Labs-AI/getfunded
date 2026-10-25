# Nomination and recipient-report dates — October 25, 2026

Explicit experimental v9 corrects the two known nomination/report failures and three corresponding event errors on a fresh, targeted source set. Across all24 fresh organizations, selected-reference date precision improves71.8%→79.5% and recall63.6%→70.5%. Evidence retention is unchanged. Remaining semantic and retrieval errors hold promotion and scaling.

| Selected-reference measure | Prior v8 | New v9 |
| --- | ---: | ---: |
| Primary20 date precision | 17/24 =70.8% | 17/24 =70.8% |
| Primary20 date recall | 17/29 =58.6% | 17/29 =58.6% |
| Separate targeted4 precision/recall | 11/15 =73.3% | 14/15 =93.3% |
| Combined date precision | 28/39 =71.8% | 31/39 =79.5% |
| Combined date recall | 28/44 =63.6% | 31/44 =70.5% |
| Labelled units retained | 52/70 =74.3% | 52/70 =74.3% |
| Pages retaining evidence | 19/24 | 19/24 |
| Local extraction wall time | 1.801 seconds | 1.822 seconds |

## Change and boundaries

V9 records literal nomination and recipient-report subjects with exact source spans and retains their dates as other events. A nomination is distinct from a direct application even when an award carries money; its name alone does not establish whether it is honorific or monetary. Final, interim, progress and other explicitly typed reporting subjects receive an obligation-scope review label. Later explicit application cues take precedence, so reports accompanying applications do not turn an application deadline into a reporting obligation. Table/section header classification uses the same subject vocabulary. Non-application ranges cannot be promoted back to application windows by a broader opening cue.

The old recognition-nomination date and recipient final-report date are corrected; the adjacent genuine application deadline remains unchanged. These two development rechecks and the direct regression are separate from fresh accuracy. In the fresh targeted set, one recognition nomination and two final-report dates are corrected while genuine application opening/closing dates remain intact. The fourth lexical match is historical event/news material, not another nomination deadline.

Prior modules and frozen results are unchanged. Ordinary packets, `program_as_of` v2 and experimental defaultv3 remain unchanged. V9 requires `--experimental-events --events-version v9` or an explicit packet argument. No worker was reloaded; no qualification or database application was enabled.

## References, yield and limitations

The primary20 uses fixed lexical quotas:3 nomination,3 report,6 dates,4 conditional,4 other. It excludes3,886 previously reviewed/selected organizations,20,245 URLs,5,470 raw hashes and1,973 inventoried normalized-text hashes. Because whole-page lexical matches often locate unrelated material, a separate four-case same-paragraph challenge was selected after the primary result, excluding that sample too. Implementation stayed unchanged. Both sets have source/code hashes and same-agent labels sealed before their respective paired predictions; neither is an external human reference or population sample.

Seventy actually-read selected units across24 organizations contain44 explicit-year date references representing40 unique case/date/event facts. Four repeated case/date references are reported separately; repeated text units omitted from scoring remain retained privately. Organization, URL, raw-hash and normalized-text duplicates are each zero. Paired predictions do not create additional organizations. These are24 bounded source readings recorded exactly once locally, not24 whole-site or organization audits.

The primary sample shows no gain. The combined improvement comes from three targeted date corrections. Eight false-positive and13 missed event references remain in v9. Gaps include award submissions whose recognition context follows the date or lacks a nomination noun, donor securities/check deadlines, nested grant-schedule headings, post-date opening labels and custom/inline markup. A cash research-award application is deliberately distinct from recognition-only awards. Policy/conditional extraction was unchanged and was not scored in this date-focused sample.

Source years, cycle inconsistencies, a literal application-link spelling discrepancy, pooled fund/target identity and a sunset notice alongside a recent footer remain unresolved and explicit. Third-party listings are not attributed automatically to the page owner. Saved observations date from October17–20; no fresh live-site checks or whole-site update dates are claimed. Full fit/inquiry and legal-entity approval remain pending.

All390 emitted evidence spans,142 date-literal spans and7 role spans across both versions match saved text exactly. No inherited context span was exercised in this sample; these checks establish citation integrity, not semantic correctness. Raw pages, excerpts, labels, reviews, source hashes and before-images stay private. New qualified funders, full-organization audits, domains, human-reviewed records, remote applications and publications are all zero.

## Cost, verification and continuation

The single ordered paired run measured1.801s→1.822s, approximately1.2% more wall time. Cache and ordering effects are uncontrolled; no speed or production-cost optimization is established. Pipeline model API calls, new web requests and Supabase calls/mutations are zero. Agent engineering/reference work is separate: the saved checkpoint records151,921 uncached input tokens,3,513,088 cached input tokens and19,952 output tokens;6,259 reasoning tokens are an output subset. Later reporting/delivery is excluded. Invoice dollars and production cost per organization are unavailable, so there is no claim that this research was free or cost-effective at scale.

The immutable inventory remains2,309,073 organizations, SHA-256 `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`. Existing workers/tracker and paused heartbeat were unchanged. No outreach, automation, deletion, merge, main push or CI polling occurred.

Next: improve award-submission scope and nested schedule attribution on development sources, then obtain untouched external semantic labels and measured operational costs before promotion. Preserve these24 completed readings as development material; do not relabel or replay them as fresh work.

Exact private continuation: `data/research/nomination-report-fresh-2026-10-25/HANDOFF-COMPLETE.json`. Primary20 and targeted4 evaluations remain separate. Pending application: `data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`, status `awaiting_separate_application`. Its exact prior bytes/hash were retained before adding an analysis-only pointer; no executable remote patch or fresh remote expected state was prepared. Future live application requires a separately requested session and exact readback.

Verified by: requested frozen paired evaluations, exact citation/once-only receipt checks, explicitv9 CLI and changed-module compilation. Tests: routine suites not run (weekly review policy); one focused escaped-bug regression failed againstv8 and passed againstv9 directly.

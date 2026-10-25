# Invitation eligibility and non-grant deadlines — October 25, 2026

Corrected the two known source failures in explicit experimental v8: “by invitation” can qualify a real proposal deadline, while a committee/volunteer nomination deadline is classified as a non-grant event. Both old cases and one focused regression confirm those bounded corrections. The fresh sample shows no overall accuracy or evidence-yield improvement over v7, so promotion and scaling remain held.

| Fresh28 selected-reference measure | Prior v7 | New v8 |
| --- | ---: | ---: |
| Date-event precision | 29/36 = 80.6% | 29/36 = 80.6% |
| Date-event recall | 29/36 = 80.6% | 29/36 = 80.6% |
| Policy precision | 27/32 = 84.4% | 27/32 = 84.4% |
| Policy recall | 27/53 = 50.9% | 27/53 = 50.9% |
| Correct condition references captured | 12/15 | 12/15 |
| Labelled evidence units retained | 61/80 = 76.3% | 61/80 = 76.3% |
| Pages retaining evidence | 27/28 | 27/28 |
| Local extraction time | 1.600 seconds | 1.500 seconds |

Retained v3 has23/36 correct date references on these same inputs. V7 already provides that gain; do not attribute it to this change. Results from the previous93.8% batch use different references and cannot establish a before/after improvement here.

## Implementation

V8 distinguishes literal eligibility qualifiers such as “by invitation,” “invitation-only” and “if you are invited” from notifications sent to applicants. Qualifiers are masked with same-length spaces only during cue matching; stored source text, dates, excerpts, offsets and hashes remain original. Exact qualifier spans are retained with an explicit “not eligibility approval” role.

Event matching identifies specific committee nominations, volunteer/staff recruitment and donor activities. A later explicit grant-application activity can take precedence; volunteer-run organizations are not automatically excluded from grants. Non-grant dates remain in evidence as other events, with the activity subject cited, rather than being discarded or published as application deadlines. Header cue matching uses the same distinction. Prior table geometry and source-occurrence mapping are reused unchanged.

Ordinary packets, `program_as_of` v2 and experimental v3 defaults remain unchanged. V8 requires `--experimental-events --events-version v8` or the corresponding explicit `build_packet` version argument. All previous modules remain available and immutable. No running worker was reloaded, and no automatic qualification or database application is enabled.

## Sample and limits

The primary20 sample has five each of date, conditional, policy and other lexical strata. It excludes3,858 previously reviewed/selected organizations,20,217 URLs,5,442 raw hashes and1,945 explicitly inventoried normalized-text hashes. A separate six-case lexical challenge and two further specific matches exclude that sample as well. Fixed source selection, code/dependency hashes and same-agent reference labels were sealed before predictions. No extractor changes followed the holdout.

Across28 distinct organizations,80 selected units from26 organizations contain36 date references representing35 unique case/date/event facts and15 condition references. Two inspected sources have no selected reference units. These are bounded readings, not whole-site or organization audits. All three versions use the same sources. Organization, URL, raw-hash and normalized-text duplicate counts are each zero; the two old-case development rechecks and direct CLI reuse are counted separately.

The primary20 date result is15/18 in both v7/v8; the six-case challenge is10/11; the two specific matches are4/7. Lexical matches do not prove that the intended event type exists: one “volunteer” match describes volunteer leadership supporting genuine grantmaking, rather than recruitment. Another invitation match is member/site-visit news excluded from the paragraph reference. The two specific sources therefore provide non-regression controls but do not establish independent native volunteer-recruitment recall or a fresh accuracy gain on the exact old phrase.

Seven date references remain misclassified in both versions. They include a nomination for an honorific award, a recipient report deadline, accepted-after/accepting-through wording, a post-date application-closing label and nested deadline-heading context. Policy and condition extraction remain unchanged and incomplete. This is same-agent selected-unit evaluation, not independent human or population accuracy, complete fit/inquiry guidance, or proof of a current open cycle.

One source literally states “Friday, September1,2027”; that date is Wednesday. Both literal pieces remain retained for review. The initial private note also suggested a first-business-day conflict; a separate immutable clarification corrects that overstatement without replacing the original note. Date-event scores are unchanged: they measure the literal event interpretation, not the truth of the publisher's calendar. Current-cycle verification remains necessary before application.

## Evidence, yield and cost

Twenty-eight actual partial claim-review steps were recorded exactly once locally. No new full-organization coverage audits, websites, qualified funders, human-reviewed records, applied database changes or publications were added. Selection matches, acquired pages, multiple event mentions and repeated extractor runs do not increment those counts.

All1,127 emitted evidence spans and14 inherited context spans match saved source text. Five new role/qualifier spans also match their original excerpts exactly. These counts prove citation integrity, not semantic approval. Publisher excerpts, raw sources, detailed labels, access information and before-images remain private. Original observation dates are preserved; no new HTTP requests or new website-currentness claims were made. Multi-entity fund-manager content is not equated to the page owner's legal identity.

The single ordered local run measured1.600s for v7 and1.500s for v8. Warm-cache and timing effects are uncontrolled; this is not a demonstrated speed optimization. V3 measured0.626s. Pipeline model API calls, web requests and Supabase calls/mutations are zero. Agent engineering/reference work is separate: the saved checkpoint records40,075 uncached input tokens,4,802,944 cached input tokens and22,516 output tokens;11,358 reasoning tokens are an output subset. Later reporting/delivery is excluded. Invoice dollars and production cost per organization are unavailable.

The inventory remains2,309,073 organizations, immutable SHA-256 `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`. Crawler/tracker processes and the paused heartbeat were unchanged. Supabase stayed read-only with zero operations. No outreach, automation, deletion, merge or main push was performed.

## Verification and continuation

The explicit v8 CLI produced an awaiting-claim-review packet with one program page and `qualified=false`. Changed Python modules compiled. One focused escaped-bug regression failed directly against v7 and passed against v8. Routine suites and CI polling were not run under the weekly policy.

Next: distinguish honorific nominations and recipient reporting from application events; improve closing-language and post-date cues and nested heading/list context. Obtain fresh direct recruitment and same-clause eligibility/deadline sources, external semantic labels, and invoiced operational cost before promotion. This completed sample is now development material; do not retune it and call the result fresh accuracy.

Private exact continuation: `data/research/event-subjects-fresh-2026-10-25/HANDOFF-COMPLETE.json`, with sealed references, three-version predictions/evaluations, `remaining-gaps.json`, the source-conflict clarification, review receipts and cost receipt. Do not replay28 steps or earlier52/70/40/60 batches.

Pending application remains `data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`, status `awaiting_separate_application`. Its exact prior bytes/hash were preserved before adding an analysis-only pointer. No executable remote patch or fresh remote expected state was prepared; any future application requires separately authorized exact readback.

Verified by: requested three-version source evaluation, exact citation/receipt checks, direct explicit-version CLI and Python compilation. Tests: routine suites not run (weekly review policy); one focused escaped-bug regression run directly as described above.

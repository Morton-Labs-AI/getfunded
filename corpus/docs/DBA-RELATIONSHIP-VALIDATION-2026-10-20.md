# DBA, acronym and entity-relationship validation — October 20, 2026

The corrected experiment recovered one additional supported association on an
untouched 32-case challenge sample, with no observed false positives. The gain
is small and processing cost increased. It remains opt-in; broad scaling and
default promotion are held.

## Implementation

New v6 source assertions retain the original v3 assertion alongside literal
DBA, exact-title, initialism and legal-subject evidence. Identity gate v4 retains
existing v3/gate-v1 decisions unless a hard hold applies. Additional matches
require the stricter evidence path; a different entity name alone cannot clear
a shared-domain conflict.

DBA checks use a literal DBA/doing-business-as declaration near the legal subject.
Initialism checks require an exact complete publisher name plus a matching local
initialism/tax declaration, or an explicit full-name (initialism) source link.
They do not use the earlier loose distinctive-token overlap. Newly admitted
multi-entity cases need both named endpoints and a relationship word in a
bounded sentence-sized source excerpt. Abbreviations, pronouns, unusual layouts,
short acronyms and unproved legal-name variants can remain held. These are
source assertions, not approved legal aliases or equalities between entities,
EINs, tax types or programs.

`build_packet(..., experimental_relationships=True)` selects v6/gate v4.
`experimental_alias_scope=True` still selects the prior v4/gate v2, and selecting
both raises an error. Ordinary packets retain v3/gate v1. The initial v5/gate v3
experiment remains reproducible, with saved source versions preserved. No
workers, tracker, queues or heartbeat were restarted or requeued.

## First pass and correction

The first independent pass froze 32 cases plus eight marker-enriched cases and
four literal-DBA controls: 44 organizations and 192 source snapshots, excluding
the previous 1,152 organizations and validation URLs/hashes.

Its strict v5 rule lost valid existing decisions. Main-sample recall fell
12/20 → 10/20 and yield12/32 → 10/32, with zero observed false positives.
Marker-case supported hints fell4/8 → 3/8; DBA controls remained4/4. That result
was saved without rewriting its labels or predictions. Those cases then became
development evidence. The correction retains established v3 evidence decisions
and adds explicit new evidence, rather than requiring every established match
to satisfy the new relationship parser.

The known earlier conflicting-publisher case is held by the corrected gate.
Known source-backed DBA and acronym false holds are recovered. These are
**development checks**, excluded from fresh accuracy.

## Second, untouched evaluation

Before predictions, freeze another 32 cases, eight source-marker cases and four
DBA-marker probes, excluding all earlier 1,196 organizations and validation
URLs/hashes. Labels and code hashes were fixed before the single paired pass.
No adjustment followed its predictions.

The main sample has12 single-EIN cases, eight mismatches and12 multi-entity
cases. The remaining disjoint funder-name multi-entity and directory source pool
could not fill the original strata, so selection broadened to nonprofit controls;
there are no new directory cases in this main sample. That selection change
occurred before labels/predictions. These are identity challenges, not a
representative funder cohort or a population-yield estimate. Agent source review
supplies the labels; no independent human adjudication is claimed.

| Main sample, 32 candidates | Existing v3 / gate v1 | Prior experiment v4 / gate v2 | Corrected v6 / gate v4 |
|---|---:|---:|---:|
| Correct supported hints | 8 | 9 | 9 |
| Unsafe hints observed | 0 | 0 | 0 |
| Supported associations held | 11 | 10 | 10 |
| Correct negative holds | 13 | 13 | 13 |
| Candidate-hint yield | 25.0% | 28.1% | 28.1% |
| Recall | 42.1% (8/19) | 47.4% (9/19) | 47.4% (9/19) |
| Observed precision | 100% (8/8) | 100% (9/9) | 100% (9/9) |
| Overall sample accuracy | 65.6% | 68.8% | 68.8% |

The one additional case has a literal source statement identifying separately
named entities as affiliated. It establishes a scoped source association, not
program equivalence, standing or funding eligibility. The corrected rule matches
the prior experiment's yield on this sample; it does not demonstrate an
incremental yield gain over v4. Its known conflict repair was checked separately
on development evidence.

Keep the enriched selections separate:

| Separate fresh selection | Existing | Corrected | Interpretation |
|---|---:|---:|---|
| Eight source-marker cases | 4 correct hints, 0 unsafe, 2 false holds | Same | 50% hint yield; 75% sample accuracy; no incremental gain |
| Four DBA-marker probes | 4 correct hints | Same | All four primary associations retained; no incremental gain |

Three of the four DBA probes concern the target's own DBA; one marker concerns
another entity and must not be transferred to the target. Only one probe emitted
an explicit new DBA proof; the others retained existing identity evidence. Thus
4/4 primary associations is **not** 4/4 DBA-edge extraction recall. Fresh acronym
coverage is also limited; a source name-order conflict remains unresolved. The
remaining ten main and two marker-case positive holds are saved explicitly.

All versions recovered222/222 labelled source-snapshot/EIN pairs, with zero
extra identifiers. Canadian registration numbers, phone fragments and license
numbers are not treated as US EINs. This is extraction accuracy, separate from
identity interpretation and funder qualification. No new real-table sample was
acquired in this turn; earlier table results are not added again.

## Cost and duplicates

The second single pass rotated version order. Across224 source snapshots:

| Local processing | Existing v3 | Corrected v6 |
|---|---:|---:|
| Extraction wall time | 2.925s | 4.993s |
| Extraction CPU | 2.871s | 4.918s |
| Identity-gate wall time | 0.034s | 0.097s |

Extraction added2.07seconds, **70.7% more wall time**. The complete three-version
measurement took13.52seconds. These are single local observations, not repeated
benchmarks, production throughput or per-discovery cost. The first iteration's
processing and later development work remain separate receipts.

There were **zero new web requests, Supabase calls, remote mutations or dedicated
extractor-model calls**. Saved publisher sources retain their original observation
dates. Engineering/source review still used this chat's tokens: at the checkpoint
(October21,04:33UTC; October20 local),87,052 uncached input,4,709,632 cached input
and38,149 output tokens over16.1minutes. Reasoning is included in output. Later
documentation/delivery is excluded. Invoice dollars are unavailable; this is
engineering cost across both iterations, not a scalable per-organization price.

Final fresh duplicates, kept separate:

- 44 organizations, all distinct; zero organization duplicates.
- 224 references and raw hashes;221 URLs, three repeated URL references.
- 219 normalized texts, five repeated text observations.
- 226 EIN mentions,222 source/EIN pairs, four repeated mentions per version.

The first44 cases have192 distinct source references/raw hashes,
192 URLs/texts and27 repeated EIN mentions; organization count is44, not192.
Across both iterations,88 distinct organizations received88 canonical bounded
identity-review records once. No prior reviews were replayed. They add **zero**
coverage audits, discovered domains, proposals, qualified funders, applied changes,
human reviews or published profiles. The original discovery pilot remains4/1000;
the immutable2,309,073-member inventory was not changed.

## Next step and handoff

Keep v6 opt-in. Next run a small, separately frozen operational discovery pilot
with a full cost receipt, plus a targeted alias-edge benchmark that distinguishes
primary identity from DBA/acronym extraction. Include post-EIN declarations,
punctuation/name variants, parent/subordinate roles, overlapping names, pronouns,
shared-site conflicts and a different table publisher. Require better measured
recall and no unsafe new matches before default promotion or large-scale research.
Zero observed false positives in this small challenge sample does not establish
population accuracy.

Private results are in `data/research/relationship-validation-2026-10-20/`
(first iteration) and `data/research/relationship-validation-fresh2-2026-10-20/`
(final fresh evaluation). They preserve code, exact sources/hashes, agent labels,
predictions, unresolved holds, cost and local-registration receipts.
`HANDOFF-COMPLETE.json` gives exact continuation steps. Pending application remains
`data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`; this work
adds only an analysis pointer, with the prior file retained as a before-image.
No executable database patch was prepared. Application requires a separate
explicitly authorized session, fresh expected-state readback and normal review.

Verified by: the frozen fresh evaluation,44 ordinary/experimental packet checks,
32 saved v4 and44 saved v5 gate outputs, ten saved citation hashes and88 canonical
review-record hashes. Tests: one focused escaped-bug regression red→green,
including the final corrected version; full suites not run (weekly review policy).
CI was not polled.

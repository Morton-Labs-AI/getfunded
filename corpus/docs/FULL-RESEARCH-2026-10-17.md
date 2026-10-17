# Full-population research — 2026-10-17

The existing Supabase access now supports research across **all 2,309,073
organizations**. The read-only Data API exported that complete population and
**1,266,695 unsuperseded filing website records**, with both counts reconciled
against the live database census. No database password, privileged API key,
role change or schema migration was needed.

This remains an active whole-database campaign, **not completed research**.
A detached 16-worker crawler processes the entire pending website queue.
The current-chat continuation runs every 30 minutes to inspect health, recover
interrupted work and continue missing-site searches, news, program review and
recipient research. All organization types remain in scope; no cohort stopping
limit is configured. Nothing has been merged or pushed to main.

## Population and acquisition

The immutable inventory contains **329,222 candidate websites** and
**1,979,851 organizations without one**. Twenty-five attributed website
discoveries have since been queued, including five during this continuation.
These are candidates, not human-confirmed identities.

Inventory SHA-256: `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`.

The API export is a paginated observation interval, not a repeatable-read
transaction. Matching counts cannot exclude same-count membership changes
during export. The census found no canonical merges or unparsed website-bearing
filings; future exports must repeat those checks.

Queue snapshot: **2026-10-17T21:51:09.932274+00:00**.

| State | Organizations |
| --- | ---: |
| HTML acquired; identity and claims still need review | 5,289 |
| Attempted, with an acquisition blocker | 3,087 |
| Currently running | 16 |
| Candidate website awaiting acquisition | 320,855 |
| Website discovery unresolved | 1,979,826 |
| Complete inventory | 2,309,073 |

**8,408 distinct organizations have a crawl attempt**, including interrupted
attempts returned to pending during recovery. The result scan from 21:51:09
through 21:51:22 UTC observed **20,620 HTML page observations** across
**19,910 distinct URLs**, **14,081 publisher-linked resource references**, and
**611 pages with an explicitly labelled EIN matching the target**.
Scanning overlaps continued acquisition, so result totals can advance beyond
the queue snapshot. Supplemental manual acquisitions are separate.

Inventory, acquired pages, query suggestions and exact-EIN observations are
not completed profiles. Human-reviewed profiles: **0**. Signals published by
this work: **0**.

## Performed research and attributed findings

This continuation recorded [80 actual website searches](../data/seed/research/evening-searches-2026-10-17.jsonl),
[five attributed candidate websites](../data/seed/research/evening-websites-2026-10-17.jsonl)
and [39 original review notes across 36 organizations](../data/seed/research/evening-notes-2026-10-17.jsonl).
The queries were executed; their output hashes and source links are retained.
An unsuccessful search leaves the website and application posture unresolved.

The full campaign now has **232 durable research-step records**:

| Stage | Records | Distinct organizations |
| --- | ---: | ---: |
| Website search | 157 | 157 |
| Identity review preparation | 24 | 24 |
| News search | 5 | 5 |
| Recipient reverse research | 17 | 17 |
| Claim review preparation | 29 | 27 |

These are agent research records, not human approvals. They do not establish
exhaustive completion for the organizations involved.

The latest substantive findings include:

- [Kelly Foundation of Washington](https://kellyfoundationwashington.org/)
  says grant and scholarship applications have stopped and dissolution is
  planned during 2026. Older application PDFs remain indexed. The notice does
  not establish a completed legal dissolution or its effective date.
- The [Hawaii Public Health Fund](https://www.cochawaii.org/programs/public-health-fund/)
  lists a December 18, 2026 deadline. Its Oahu health program is distinct from
  the Chamber's state-funded business-disaster grants.
- [Endowment for Health Opportunity Grants](https://www.endowmentforhealth.org/opportunity-grants)
  describe monthly review, typically $1,000–$20,000 and one-time terms of a
  year or less. The program's exclusions and New Hampshire scope are retained.
- [AAJR's dissertation call](https://aajr.org/funding-opportunities/dissertation-research-funding/)
  is for 2026–2027, with a February 2, 2027 deadline. News publication dates,
  award years and application cycles remain separate.
- The [Health Care Foundation of the Oranges](https://www.hcfoinc.org/grants)
  explicitly closes its 2026 LOI window. This is a cycle-specific application
  finding, not organizational closure.
- FARFE's [mission page](https://www.farfe.org/mission.html) describes a
  $100,000 Ross Prize, while its [ninth-prize announcement](https://www.farfe.org/ross_prize.html)
  says $75,000. Both source-specific amounts are retained as a conflict.
- [O'Reilly's foundation page](https://corporate.oreillyauto.com/foundation/)
  was readable through indexed web evidence, but direct acquisition was
  blocked at robots HTTP 403. Annual application timing and exclusions are
  attributed to that page, without treating the window as currently open.

New recipient evidence includes Nichols/Culver-Stockton, Beyond Reynosa/Chennault,
Sigrids/Lacawac, Lorch/Apron, Blum/Berkeley Law, the Lauren family foundation/NYRP
and Abramson/Brem. Donor tiers, membership prices, date ranges, acknowledgments
and exact paid grants are kept distinct. The Meyer trust name variant remains
unresolved. Provider profiles and a host site's grants navigation do not turn
the profiled organization into a grantmaker.

Earlier [follow-up notes](../data/seed/research/followup-notes-2026-10-17.jsonl)
and [continuation notes](../data/seed/research/continuation-notes-2026-10-17.jsonl)
retain the Stabler DAF transition report, UK Biobank recipient evidence,
McKnight's separate 2027 cycles and conflicting opening dates, Sarkisian's
student/institution rules, a TYH namesake with a different EIN, and a filed
domain now serving unrelated casino content. Namesakes, parent organizations
and affiliated foundations are not automatically merged.

## Existing database candidate path

The live workflow contains **19 first-party source definitions** and **255
unreviewed URL candidates**, with **zero published signals**. The latest
addition is two sources and ten URLs from Endowment for Health and AAJR.
All ten link to existing organizations; none has a reviewer.

Raw files **468–469** were registered before parsing. Ledger runs **554–555**
completed with two source insertions, ten candidate insertions and no skips.
The original compilations are
[evening source definitions](../data/seed/evening_signal_sources.csv) and
[URL candidates](../data/seed/research/evening-signal-candidates-2026-10-17.csv).
Earlier additions retain raw files 462–467 and ledger runs 548–553.
Candidate discovery does not automatically promote deadlines, amounts,
eligibility, identity matches or editorial posts into approved facts.

Publisher bodies, search-result bodies, snapshots, full exports, the local
queue and access configuration remain private. Public compilations retain
attribution and source hashes. Original compilation licensing does not
relicense publisher content. Existing human review and publication gates
remain intact; no agent marked a human decision.

## Continuation and verification

The [research protocol](ORGANIZATION-RESEARCH.md) covers resumable API shards,
shared host pacing, robots and Retry-After handling, immutable compressed
snapshots, original observation dates, disk protection and performed
research-step records. Worker PID 91991 remained healthy during this turn,
with about 250 GiB free disk; no restart was needed.

Program-path and body-link priority was directly verified in the earlier
six-page McKnight crawl. Six pages do not complete research. The worker
continues every pending website job while missing-site and claim research
proceed independently. The [additional source opportunities](RESEARCH-SOURCE-OPPORTUNITIES.md)
document identifies 990-N, linked PDFs, rendered public pages and recipient
adapters as proposals subject to source-intake and licensing review. They are
not counted as implemented coverage. The [initial report](RESEARCH-2026-10-17.md)
remains a dated historical baseline.

Verified by: actual research-step recording and candidate assignment; one
direct data check of the 80 searches, five websites, 39 notes and full
population total; live source/candidate counts, all ten organization links,
zero new reviewers and completed ingestion ledgers.
Tests: not run (weekly review policy). CI checks were not polled.

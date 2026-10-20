# Resumed research — October 18, 2026, 09:17 UTC

The user authorized restarting local research on `codex/funder-research-coverage`.
Crawler and tracker were absent, both locks were released, 33 API checkpoints
were present, and free disk was approximately 193 GiB before restart. The complete
inventory hash matched `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`.
At 09:01:40 UTC, the existing crawler resumed with 16 workers, six pages per job,
follow mode, shared host pacing, robots/TLS/public-IP/body-size safeguards and
its 10 GiB disk guard. Interrupted jobs use existing lease recovery. The local
tracker is available at http://127.0.0.1:8768. The old heartbeat remains paused;
no automation or keep-awake process was created.

## Recorded work and boundaries

This session recorded **129 research steps**: ten reconciliation records for
saved work, 64 missing-site discovery records, 26 supplemental source/recipient
reviews, 28 program/search reviews and one structured-signal source review.
There were **104 newly executed query strings**, plus eight previously executed
queries reconciled from the saved batch without replaying them. Generated next
queries are not included. The 64 new discovery targets received exact-name,
EIN and locality searches; two candidate websites were queued locally (JX and
Surf8). These remain agent candidates, not human identity approvals.

At the dated snapshot there are **914 research steps across 661 organizations**:
480 website searches, 127 identity reviews, 29 news searches, 61 recipient/reverse
reviews and 217 claim reviews. Stage overlap is intentional. These counts include
unresolved attempts and do not represent completed profiles.

| Acquisition state | Organizations |
| --- | ---: |
| HTML acquired; review pending | 47,235 |
| Blocked | 26,963 |
| Missing website | 1,979,809 |
| Queued | 255,050 |
| Running | 16 |
| Preserved total | 2,309,073 |

There have been 74,230 crawl attempts. Free disk was 192.4 GiB. Acquired pages,
searches and generated queries are not verified organizations. The historical
resource-link scan and remote database counts in the coverage artifact retain
their old observation times; neither was refreshed in this session.

## Substantive findings

- [JX](https://jxgivesbackfamilyfoundation.org/) prints the target EIN. Its
  community focus has no established fixed application deadline or award amount.
  [Gateway’s report](https://www.gtc.edu/public%3A/files/documents/1709057292/February%202024%20PRESIDENT%26%23039%3BS%20REPORT.pdf)
  provides historical gift/pledge evidence, not a new 2026 payment.
- [Serini Small Grants](https://www.hjsfoundation.org/small-grants-program)
  explicitly says closed. Older rolling language does not establish reopening.
- [Pennington guidance](https://www.penningtonfamilyfoundation.org/grants-center)
  and indexed portal dates disagree; the direct portal exposed no program rows.
  Predecessor-foundation awards and recipient partner listings require a legal
  bridge. Award ranges, reporting years and gala-wide fundraising are kept separate.
- [Reggie Smith contact](https://www.thereggiesmithfoundation.org/contact)
  prints a different EIN from the Dallas target. Aman’s filed domain describes
  an Illinois organization rather than the Louisiana target; Newman’s filed
  domain now names Naderkhani; Mirador’s points to a generic directory. No target
  program facts were inferred from these mismatches and no filed values erased.
- [Lyceum’s 2027 portal](https://competition.lyceum-fellowship.org/home/application/)
  advertises May 27, 2027 at 8pm EDT. Its separate travel-prize tiers do not apply
  retroactively to 2026 winners. [Futuro Dominicano](https://futurodominicano.org/tuition-grant)
  and [Kurt Schork](https://ksmfund.org/2026-awards/) describe already-passed 2026
  deadlines. Application forms were not submitted.
- [GitLab’s July announcement](https://www.gitlabfoundation.org/our-journey/peof-launch-2026)
  distinguishes a $4 million round, a $500,000 award ceiling and a $16 million
  partnership. Concept notes closed August 12. The [program page](https://www.gitlabfoundation.org/powering-economic-opportunity)
  requires an active employer/industry partnership and describes fall invited
  review. Earnings projections are not grants. One new candidate is staged.
- Packard recipient institutions support the later $985,834 fellowship figure;
  the earlier $875,000 discrepancy remains unresolved. UCLA’s republished release
  is not independently authored corroboration. Illinois TLS and JHU robots
  failures were retained without bypass.
- [UVM](https://www.uvmhealth.org/newsroom/uvm-medical-center-continues-nurses-week-celebration-announcing-nursing-awards-and-scholarships)
  and [SUNY Adirondack](https://www.sunyacc.edu/documents/nursing-student-handbook-0)
  corroborate Riley Olson nursing awards with different institutional and time
  scopes. They do not prove a current payment from the target foundation.

## Pending application, privacy and provenance

**No Supabase calls or remote mutations were made in this resumed session.**
Saved candidate IDs 57, 61, 62, 64, 86, 87, 90 and 91 remain pending application,
as does one new GitLab proposal. One recipient supplement attaches to pending
ID57; it is not a tenth distinct structured candidate. Applied this session: 0.
Human-reviewed: 0. Published by this workflow: 0.

The exact saved before-images and existing raw-file registrations 500–508 remain
unchanged, as does interrupted ledger 562. This description relies on the prior
stopped-session readback, not a fresh remote query. The immutable daybreak public
compilation was preserved byte-for-byte. Saved source reviews and searches were
recorded once; heartbeat-0744 work was not replayed.

Private backlog entry point:
`data/research/full-2026-10-17/resume-2026-10-18/pending-application.json`.
It references saved before-images/hashes, expected candidate states, the ID57
supplement and new GitLab proposal. For the new proposal, remote row existence is
unknown; separate application requires fresh readback and zero matching rows, or
saving a full existing before-image and preparing a reviewed update. Do not
blindly insert or register duplicate sources. Do not complete ledger 562 here.

Raw pages, publisher excerpts, search-result payloads, before-images and access
configuration remain in ignored private storage. Only original attributed notes,
query strings, hashes and review-gated candidate summaries are committed. No
files or rows were deleted. Publisher sources are not licensed for republication;
original compilations retain agent attribution and require human review/publication
approval. New supplemental acquisition attempts included three timeouts; existing
web results are explicitly distinguished from guarded source snapshots.

## Next exact steps

1. Leave the crawler and tracker running. Check worker status and disk before
   another batch; recover through the normal lease mechanism if interrupted.
2. Execute the 32 suggested searches in private
   `resume-2026-10-18/next-discovery-worklist.json`, then record actual results with
   `funderdb research record-step`. The worklist itself is not research.
3. Resolve target identity for Aman, Newman, Mirador, Pennsylvania Wireless and
   the Iowa scholarship fund. Review Lyceum’s 2027 brief and UVM’s original
   publication date; independently corroborate newer recipient payments without
   carrying forward historical award amounts. Preserve retrieval failures.
4. Continue current-cycle and recipient research on other unreviewed organizations
   regardless of pending application. Do not replay completed reconciliation scripts.
5. Only in a separately requested application session, read current remote state,
   compare exact before-images, deduplicate source hashes and review the backlog.
   Keep candidate, applied, human-reviewed and published counts separate.

Verified by: stopped-process/lock/checkpoint and inventory-hash checks, local tracker inspection, existing evidence verifier, and one direct compilation/provenance check. Tests: not run (weekly review policy).

AI-assisted original research by Codex. Human review and human DCO sign-off remain pending.

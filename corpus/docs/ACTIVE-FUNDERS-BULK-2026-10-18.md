# Bulk active-funder evidence review — October 18, 2026

The first bulk pass completed **37,063 organizations and 172,750 saved page
checks**, producing **383 local proposals with 868 literal claim records**.
The next immutable wave completed another 1,175 organizations. At the separate
16:01:28 UTC observation, cumulative totals were **38,238 distinct organizations,
178,519 page checks, 389 proposals and 880 claim records**, with no source revision
rechecks yet. Acquisition and later waves continue. These are automated source
audits and literal candidates, not completed qualified-funder profiles.

The target remains 150,000 evidenced funding organizations. The search pool is
235,324 candidates; an operating charity with a live website is not automatically
a funder. Fully verified, remotely applied, human-reviewed and published counts
remain zero. No rule precision/recall or total token-savings claim is established.

## What the bulk pass actually checked

The new [bulk command](BULK-FUNDER-REVIEW.md) freezes acquired live-site cases,
checks subsection03 source eligibility, assessment/result/page hashes and saved
filing identity rows, and inspects substantive HTML blocks for literal outgoing
funding and application-policy assertions. Four local CPU processes perform this
saved-source work without network or model calls. Interactive research costs
remain separate. Existing source safeguards and strict citation-span staging are
retained; there is no semantic or human approval shortcut.

Initial-pass dispositions were:

| Disposition | Organizations | Interpretation |
| --- | ---: | --- |
| Literal funding candidates with entity support | 383 | Program, speaker, cycle and policy scope require review. |
| Outgoing funding evidence, identity pending | 76 | Do not attach claims to the target until the entity bridge is resolved. |
| Publisher EIN conflicts | 220 | A shared site can describe multiple entities; a conflict is not automatic rejection. |
| Funding role not established in acquired content | 36,384 | Neither a negative funder decision nor proof of inactivity; bounded sources and narrow extraction can miss evidence. |

The initial pass found 2,602 exact publisher-EIN cases, 23,771 saved
filer/EIN/domain bridges with a publisher-name match, 10,435 domain-only bridges,
33 unavailable bridges and two filing/entity/domain conflicts, alongside the
220 publisher-EIN conflicts. These categories describe identity evidence, not
human confirmation or current federal standing. A name match inside a page also
requires interpretation. There were 390 cases with conflict flags; these overlap
the dispositions and do not represent 390 distinct proven contradictions.

Page-scoped publication/modification evidence remains separate from the unknown
whole-site update month. Acquisition dates, copyright years, future events and
announcements do not establish a last editorial update or recent paid donation.
No exact trailing-twelve-month payment was certified by this pass.

## Resolving gaps alongside the sweep

Three manual program-source reviews staged three additional proposals with
14 claim records. They overlap the broad source-review scope and must not be
added to automated counts as distinct facts or fully verified organizations.

- [Community Memorial](https://cmfdn.org/apply-for-a-grant/) invites a fit
  conversation. Its 25,000 threshold triggers an LOI rather than capping an
  award. Recurring submission dates lack a cycle year; archived news does not
  establish current intake. The [responsive-grants page](https://cmfdn.org/our-work/responsive-grants-program/)
  retains additional timing and portal-transition evidence.
- [Phelps](https://phelpscommunityfoundation.org/grantmaking/apply/) welcomes
  LOIs while full proposals require invitation. These are different stages,
  not an organization-wide closure. The [general guidelines](https://phelpscommunityfoundation.org/grantmaking/general-grant-guidelines/)
  use narrower geography than another page. Preserve that difference and the
  yearless deadlines. Prospective disbursement dates are not payments.
- [Lohengrin](https://lohengrinfdn.org/?page_id=2014) has a May 2026 strategy
  announcement. Its consultant procurement is distinct from nonprofit grant
  intake, and its archived grant call is closed. The
  [contact restriction](https://lohengrinfdn.org/?page_id=155) does not permit
  unsolicited funding inquiries outside an active call. Manual interpretation
  found funding-role evidence omitted by the narrow first-person screen; the
  original automated abstention remains intact.

Eight additional identity-scope reviews distinguish Talem's separately numbered
entities; Stardust's different-EIN fertility foundation; Burkitt's unestablished
relationship to its community-foundation host; the BRICC and TEEEM namesakes;
an incompatible directory identifier; an operating garden versus its possible
supporting foundation; and Building Hope's fund versus a holding company and
future reporting transition. None is an authorized merger or closure decision.
Two matching-EIN, previously missing-site inventory records received attributed
website candidates and guarded acquisition. The older different-EIN records remain.

These manual activities added **13 actual research-step records**: three claim
reviews, eight identity-scope reviews and two discovery identity records. No new
web-search query was executed in this continuation. Bulk audits use their own
`evidence_sweep` stage, not the manual review stages. Eleven original attributed
paraphrases are in `data/seed/research/active-funder-bulk-review-2026-10-18.jsonl`.

## Continuing at scale

The completed initial pass is immutable. The worker follows new organizations
and changed acquired source results in further immutable 1,000–10,000-case waves.
An already audited organization/result-hash pair is excluded. A source revision
counts as a recheck, separately from distinct organizations. The tracker shows
initial completion, cumulative audits, unique organizations and rechecks.

**2,500 source-backed follow-ups were queued**, with no conditional-update skips,
through the existing 16-worker crawler. They prioritize unvisited same-host grant,
application, guideline, eligibility and funding pages with entity support;
160 have literal funding-role evidence. Previously interpreted workspaces and
publisher identity conflicts were excluded. All selected URLs were present in
saved evidence; none was guessed. URL selection and queuing are not completed
research or qualification. Exact queue before-images and prior result copies
are private. Six pages per pass, shared host pacing, robots/TLS/public-IP/body
limits and the 10 GiB disk guard remain in effect. No competing crawler exists.

A dated private worklist contains 853 semantic/identity tasks from completed
reviews, prioritized by entity-supported funding assertions and page-date leads.
This is a generated worklist, not 853 completed analyst reviews. Continue
interpreting current program and inquiry scope, preserve conflicting evidence,
and pursue recipient-side corroboration without treating an announcement or
fiscal year as an exact payment date. The recent-giving source gap remains open.

## Application boundary and exact next steps

Supabase remained read-only. A count SELECT and one complete 19-row web-fact
SELECT saved exact before-images privately. Each candidate has the dated exact
expected row state, source hashes and `awaiting_separate_application` status.
An optional read-only historical-grant census did not return before the local
wait ended; remote completion/cancellation is unknown. Its exact query is saved
as deferred and must not be replayed or rerouted. Independent research continues.

There were no remote mutations, raw-file registrations, ledger updates, executable
remote patches, reviewer attribution or publication decisions. Earlier raw files
500–508 and interrupted ledger562 remain untouched. Full inventory **2,309,073**
and SHA-256
`f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`
were rechecked unchanged. Sources, excerpts, searches, contacts, configuration and
before-images remain private; only original paraphrases and aggregates are public.

Private pending entry:
`data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`.
It links the bulk `pending-index/`, additional `waves/`, manual proposals,
identity supplements and all prior backlogs/supersessions. Do not total claim
records without deduplication and supersession review. Live application requires
a separately requested session, fresh exact readback, scope adjudication and
existing human/licensing/publication gates.

1. Inspect current PIDs, leases, checkpoints and disk before any restart. Keep
   crawler 16 workers/six pages, evidence follower and bulk follower running;
   tracker remains loopback port8768. The heartbeat stays paused.
2. Inspect `bulk-sweep-2026-10-18/targeted-gap-acquisition/queued-work.json` against
   current acquisition outcomes; let new assessments enter additional waves.
   Preserve unresolved and blocked outcomes rather than calling them dead sites.
3. Use `bulk-sweep-2026-10-18/next-semantic-review-worklist.json` for program/cycle,
   entity and inquiry interpretation. Preserve immutable audits when manual
   interpretation supplies additional evidence or corrects scope.
4. Continue exact-name/EIN/locality discovery and independent recipient research.
   Do not pad the 150,000 target with unknowns. Detailed rule/model benchmarking
   follows actual target work and needs independently adjudicated examples and
   a holdout; no paid model batch or automatic promotion is running.

The bulk coordinator resumed through saved checkpoints after the completed pass
to load revision following; the tracker restarted to display unique/recheck
counters. Disk remained about 162 GiB free at the subsequent observation. The
workers continue after this dated report. No outreach, deletion, subagents,
new automation, main push or merge occurred.

An early follow-up wave also exposed timestamp-only assessment rechecks after
queue reprioritization. They remain in the dated history as rechecks, never new
organizations or new verified facts. Following now compares acquired-result
hashes rather than assessment read times, preventing further same-result waves.
Overlapping candidate records remain subject to deduplication before application.
The 16:05:01 UTC reconciliation retained 39,336 case audits across 38,289 distinct
organizations: 1,047 rechecks, of which 1,045 repeated the same acquired result.
The 479 proposal records contained 390 distinct input hashes and 89 repeated
identical inputs. The 1,142 claim records contained 883 distinct literal payload
hashes, not 883 independently verified facts. Exact duplicate groups are linked
as a mandatory private application gate. The tracker separates distinct inputs
from cumulative proposal/claim records, which include rechecks.

Verified by: the actual completed 37,063-case command and subsequent 1,175-case
wave, strict proposal staging, source/before-image and inventory hashes, guarded
queue updates, and one load of the updated tracker page. Tests: not run (weekly
review policy). No CI polling. AI-assisted implementation and original research
by Codex; human review and human DCO sign-off remain pending.

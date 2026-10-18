# Active-funder campaign revision — October 18, 2026

The user narrowed the 150,000 target to funding organizations with an actual
outgoing donation in the past twelve months or a live funder website. The
[revised protocol](ACTIVE-FUNDERS-150K.md) now separates URL liveness, supported
page-update month/year, and fit/inquiry evidence. The original fixed cohort and
all prior pending work remain intact. This is ongoing research, not completion
of 150,000 verifications.

At **11:33:39 UTC**, the saved-source worker had processed **8,150** candidates.
The expanded search pool contained **59,414** unique-EIN c3 candidates. These
counts describe research scope and mechanical dispositions, not qualified or
fully verified funders.

| Evidence dimension | Observed disposition |
| --- | --- |
| Candidate URL with recent same-host usable HTTP200 content | 7,412 |
| Candidate URL not confirmed or observation stale | 393 |
| No acquired page / acquisition blocked | 331 |
| Suspected parking or unrelated-content lead | 14 |
| Matching EIN + outgoing funding language + live URL; semantic review pending | 22 |
| Recent page modification/publication date lead | 1,549 |
| Only older page dates observed; overall currency unknown | 494 |
| Update month/year unknown | 6,107 |
| Grant-inquiry guidance lead requiring route/posture review | 336 |
| Grant-inquiry route not established | 7,814 |
| Semantically verified / applied / human-reviewed / published | 0 / 0 / 0 / 0 |

The latest page date is not a site-wide update date. Modification and publication
are separate, publisher-asserted fields with pointers into preserved snapshots.
Copyright years, server headers and fetch time do not establish editorial
currency. Generic contact links and donation forms do not establish an invitation
to submit a proposal. Missing evidence stays unknown.

A GET-only query of public funding events for positive `grant` records with
exact dates in **2025-10-18 through 2026-10-18** returned no rows. This is an
observation of that view/query, not evidence that funders made no recent gifts.
Existing fiscal-year-only records cannot prove a payment inside the window;
source payment/date-precision review remains required. No commitment, filing or
announcement date was substituted.

The original eligibility observations covered 135,060 private foundations and a
partial 150,000 public charities. The new serial GET-only export had reached
294,000 public-charity observations when this report was recorded and remained
incomplete. It resumes hashed keyset checkpoints, expands the search pool without
padding the target, and preserves content-hashed membership additions/vintages.
No source was registered remotely. A local SQLite snapshot-upgrade conflict
encountered during concurrent expansion was corrected by materializing the read
before reserving the local writer; a subsequent expansion added 18,816 members
while the follower continued. Exact local before-images retain crawler priority
changes; the existing 16-worker/six-page crawler still performs acquisition.

Two substantive source reviews produced **two new staged proposals / five
claims**, each checked against literal source spans in the existing candidate
format. Two claim-review records were added once to local `research_steps`.
No new search queries were executed in this revision. The accumulated full
campaign had 924 research-step records across 670 organizations and 79,622 crawl
attempts at its separately dated snapshot. None of these counts certify profiles.

- [Delaplaine application instructions](https://delaplainefoundation.org/apply-for-funding/)
  distinguish first-time, renewal and returning applicants. Renewal routing uses
  receipt of funding within three years. The review stages role/routing evidence
  but retains unknown current openness and cycle-year deadlines. Two claims.
- [Godley homepage](https://godleyfamilyfoundation.org/) and
  [foundation description](https://godleyfamilyfoundation.org/about/) support
  outgoing grantmaking, geographic focus and a restriction on unsolicited
  proposals. Homepage metadata reports October2026 modification; that does not
  establish the policy's effective date or whole-site currency. Three claims.

Organization-level focus, geography, inquiry policy and inquiry route now fit the
strict proposal contract without inventing a program cycle. Cycle-specific
status/deadline requirements remain. A single-case review workspace connects an
active-pool assessment to the existing bounded work-item and proposal validator.
Delaplaine's work item contains 11,756 excerpt characters from 63,143 source
characters; Godley's contains 3,494 from 17,494. These are character measurements,
not token charges or measured savings. The worker makes zero model calls;
interactive agent spend is unmeasured.

Read-only database before-images showed no existing `org_web_facts` rows for
either organization. Exact UUID/empty-state observations, response hashes and
source-backed proposals are saved privately. No executable database patch was
constructed. That table represents a human decision, so these proposals must
retain the separate application and human-review gates. The existing remote
raw500–508 and interrupted ledger562 remain untouched. No funder contact,
deletions, main push, further merge or new automation occurred. Heartbeat paused.

## Exact continuation

1. Inspect `active-process.json`, `eligibility-process.json`, their logs/leases and
   checkpoints in `data/research/active-funders-150k-2026-10-18/` before restarting.
   Current recorded PIDs: evidence70913, GET export71983, tracker68440;
   full crawler18540 remains active. Check identities rather than trusting PIDs.
2. Let the follower process saved sources and the GET exporter extend c3 evidence.
   Its final fresh CLI initialization appends pool members and prioritizes pending
   acquisition with exact local before-images. Do not launch a second crawler.
3. Review the 22 mechanically supported website candidates, then live funding
   leads with unresolved identity. Use `active-funders-prepare` for bounded source
   context and `evidence-submit` against its returned proposal workspace. Preserve
   negative inquiry policies, scope, actual dates, conflicts and unknowns. Resolve
   the paid-donation branch through actual source payment evidence.
4. Continue missing-site discovery and independent recipient/current-cycle review
   through existing local research steps; generated queries are not completed work.
5. The pending-application entry point is
   **`data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`**.
   It links the retained original cohort, resume backlog and continuation0758.
   No Supabase mutation, registration or ledger completion belongs in this session.
6. The original cohort's completed disposition pass does not complete this revised
   target or trigger the deep rules phase. After substantive work through the
   actual revised cohort, document detailed if/then rules and counterexamples,
   create independently adjudicated frozen evaluations/holdouts, and measure
   cheaper-model quality and real cost before proposing promotion.

Verified by: changed Python compilation, real pool expansion while the follower ran, 250-case direct processing, the tracker page, GET-only dated-grant readback, two real proposal/work-item flows and local acquisition prioritization. Tests: not run (weekly review policy).

Original research and implementation by Codex; human review and DCO sign-off pending.

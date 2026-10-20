# Active-funder evidence gaps — October 18, 2026 continuation

This continuation reviews the strongest source-supported live-site candidates,
checks program-specific fit and inquiry rules, and retains unresolved evidence.
The target remains 150,000 funders; no completed-profile or human approval is
claimed. Supabase was read-only throughout.

**Twelve organizations received substantive source review.** Sixteen new local
proposals contain 59 source-span-checked claim records. One earlier rolling-intake
claim is explicitly superseded by a dedicated page's closure notice, leaving 58
current claim records within this continuation. The original bytes are retained.
These are staged records, not database applications, published facts, or 12 fully
verified profiles. Existing backlogs are separate; do not sum them without
resolving overlapping opportunities and supersession.

The work adds 16 claim-review records and seven search/reverse-research records,
covering eight actual queries. Five targeted reacquisitions ran through the
existing 16-worker, six-page crawler. They used observed publisher links and
explicitly reviewed public partner sources. No second crawler, contact, login,
form submission, model batch or new automation was used.

## Useful fit and inquiry distinctions

| Funder/program | Evidence supported by the reviewed sources | Remaining limit |
| --- | --- | --- |
| [Impact Austin g3](https://www.impactaustin.org/apply-for-g3-grants) | Youth grant calendar runs September 28–October 23, 2026; deadline 5 PM CT. Public charities serving four named Texas counties; dedicated grant-question route. | Calendar supports a current-window candidate, not a checked portal submission. Main grant page and youth news mix years; preserve their conflicts. |
| [Whatcom YPP](https://whatcomcf.org/apply-for-a-grant/) | 2027 cycle calendar opens October 16, 2026; literal deadline `5:00 pm 1/24/27`. Fiscal sponsorship questions invited. | Deadline timezone unstated. Other programs open November 13. Theme placeholder contacts were excluded. |
| [Ireland Family Foundation](https://irelandfamilyfoundation.org/grants-and-programs) | Rolling initial LOIs and pre-LOI fit conversations invited. Autism research and adult autism services have distinct scope; affiliation exclusions explicit. | Update month unknown; historical grant ranges do not set future award bounds. Full proposals follow invitation. |
| [Denton](https://www.dentonfamilyfoundation.net/grant-application-process/) | Harrisonburg-area nonprofits; written proposals preferred over meetings or LOIs; no formal deadline stated. | Grant instructions undated; homepage modification does not date that policy. |
| [Placer](https://www.placercf.org/grant-guidelines) | Western-slope service restriction, nonprofit eligibility with scholarship exception, and explicit permission to ask the office for current guidelines. | RFP timing varies by program. No current grant window inferred. |

Clear policies also prevent wasted applications:

- [AAPD](https://aapdfoundation.org/apply-for-grants/) explicitly closes its
  2027–2028 one-year round. Its larger-grant invitation rules must not be applied
  indiscriminately to ordinary grant questions.
- [Serini's dedicated small-grants page](https://www.hjsfoundation.org/small-grants-program)
  is closed despite generic rolling copy elsewhere. The rolling rule applies
  only when the program is open. Major grants separately decline new requests
  in 2026 and 2027; a 2028 check-back is not a promised opening.
- [Collier](https://colliercf.org/nonprofits/apply-for-grants/) closes its FY27
  competitive programs. Wish List participation is separate and donor advisors
  do not accept direct solicitations. Fiscal-year labels and month/day dates
  were not normalized into invented deadline years.
- [Impact San Antonio](https://www.impactsanantonio.org/nonprofit-applicants/)
  ends its 2026 application period and defers 2027 details. Its applicant rules
  include public-charity status, a recent 990/990-EZ and an eight-county service
  area. Member voting and award-night dates are not application deadlines.
- [Pisgah](https://pisgahhealthfoundation.org/grants) describes an expired
  July–August 2026 cycle while explicitly offering grant-process assistance.
  Fiscal sponsorship is addressed; an investment-manager RFP is procurement.
- [Arthur Skodnek](https://www.arthurskodnekfoundation.org/granting) expressly
  restricts grant inquiries to invitations and says unsolicited funding requests
  will receive no response. Historical awards do not establish present appetite.

## Program handoff and recipient evidence

[RENEW Wisconsin's February 2026 announcement](https://www.renewwisconsin.org/changes-coming-to-solar-for-good/)
and its [annual report](https://www.renewwisconsin.org/2025-2026-annual-report/)
confirm the solar-program handoff from Couillard. The current
[program page](https://www.renewwisconsin.org/solarforgood/) supplies an online
application route and program-specific assistance. Older Couillard pages retain
MREA and year-round language. This is a program-administration change, not a
legal-entity merger or proof that the foundation dissolved. The fall calendar
omits a year; no 2026 deadline or current-open claim was manufactured. A grant
reservation pending installation is not a completed payment.

Two searches did not find an authoritative City of Auburn acknowledgment for
Placer's reported planning grant. The foundation's contribution, the city's
contribution and the business association's contribution remain separate.
Recipient confirmation and exact payment date are unresolved. A Skodnek reverse
search returned the funder's page and third-party aggregators, not first-party
recipient corroboration. Vendor update dates and fiscal-year amounts were not
converted into recent payments. Pisgah's dated award announcement identifies
recipients, but announcement/selection is not a disbursement date.

## Crawler recovery and evidence-reader repairs

The crawler stopped with a SQLite lock error during a completed-result
checkpoint. The competing lock owner was not recorded. Queue prioritization
previously reserved a writer while joining/sorting the large pool and writing
before-images, so that work now precedes bounded 500-row conditional write
transactions. The crawler retries transient local busy/locked checkpoints,
retaining the fetched result rather than repeating its network operation.
Other SQLite failures still raise. Restart recovered existing running leases.

Four saved-source assessments had been blocked by malformed publisher hrefs,
including invalid bracketed URLs. Such a link does not establish source-file
corruption. The reader now records and skips invalid links, retaining intact
page evidence. URL, credential, scheme, port, public-IP, TLS and robots guards
remain in place; no rejected link is fetched. Four local revision checkpoints
request reassessment without new network requests. All four reassessments completed without new network fetches: one is now an
identity-pending funding lead and three still lack outgoing-funder evidence.
None remains blocked for source integrity. The original blocked assessments and
new source outcomes are both retained.

Each escaped bug received one focused regression: failure reproduced before the
fix, then the same regression passed. No routine suite or CI polling was run.
Applicant-labeled links now participate in application discovery; the actual
saved Impact San Antonio page directly verified that classification.

## Dated scope and exact continuation

The saved progress snapshot at 12:38:22 UTC has a 235,322-member search pool and
51 mechanical website candidates awaiting semantic review. The public-charity
GET export completed with 1,523,060 observations; 135,060 private-foundation
observations were previously saved. None of these export/disposition counts
means funders were verified. The full 2,309,073 inventory and immutable hash are
unchanged. The snapshot records 947 research steps across 678 organizations.
The full crawler had reached 81,381 attempts in its separately dated snapshot.
Live tracker: http://127.0.0.1:8768/.

1. Read current process metadata and verify identities/leases before restarting.
   The crawler and saved-evidence follower continue; the GET exporter completed.
   The old heartbeat remains paused.
2. Review the saved source-supported current-cycle candidates first, preserving
   distinct programs, exclusions and literal dates. Then work through the
   remaining mechanical candidates and strong identity-gap leads in
   `gap-review-2026-10-18/next-review-worklist.json`. The list is unexecuted work,
   not additional research. Use `active-funders-prepare` and the returned
   immutable workspace for exact-span proposal staging.
3. Keep whole-site update dates unknown without whole-site evidence. Resolve
   missing payment dates, program calendar years, portal status and independent
   recipient acknowledgment without substituting search snippets or assets.
4. Pending-application entry:
   **`data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`**.
   It links this continuation's `pending-application.json`,
   `followup-pending-application.json`, and **`claim-supersession-01.json`**.
   Apply no superseded rolling-intake claim. Exact existing-row before-images
   and expected empty states for all twelve organizations remain private;
   fresh readback and separately authorized application/human review are required.
   No executable patch or human-confirmed row was created.
5. Continue independent work. Existing remote raw500–508 and ledger562 are
   untouched; do not register sources or complete the ledger in this session.
   Detailed learned rules and cheaper-model evaluation still follow substantive
   work through the revised target, not the old mechanical-disposition milestone.

Verified by: real source-span staging and bounded reacquisition, crawler recovery,
actual applicant-link extraction, and two focused escaped-bug regressions (each
failed before the fix and passed after). Tests: routine suites not run (weekly
review policy); only those two regression exceptions were run.

Original implementation and attributed source research by Codex. Human review and
human DCO sign-off remain pending.

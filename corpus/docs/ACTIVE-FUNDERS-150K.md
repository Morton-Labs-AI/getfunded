# Active-funder evidence protocol

Latest continuation: [identity and program-scope report](ACTIVE-FUNDERS-SCOPE3000-2026-10-18.md). It separates completed source waves, targeted acquisitions, actual source interpretation and duplicate observations; all application remains pending.

The October 18 scope correction replaces the original foundation-first ranking.
The target is **150,000 evidenced 501(c)(3) funding organizations**, prioritizing
actual outgoing donations in the trailing twelve months **or** a live funder
website. The original fixed cohort is retained as a historical baseline. It
cannot establish that 150,000 funders met these new criteria.

The immutable 2,309,073-member inventory is unchanged. Supabase remains GET-only;
all research and assessments stay local and private. No outreach is performed.

Latest continuation: [next 3,000-case wave and evidence gaps](ACTIVE-FUNDERS-NEXT3000-2026-10-18.md),
following [bulk source review and targeted gap acquisition](ACTIVE-FUNDERS-BULK-2026-10-18.md),
following [identity bridges and inquiry guidance](ACTIVE-FUNDERS-IDENTITY-GUIDANCE-2026-10-18.md),
following [source gaps and corrected program guidance](ACTIVE-FUNDERS-GAPS-2026-10-18.md).
Preserve claim-specific supersession records before any separate application.

The [bulk source-review workflow](BULK-FUNDER-REVIEW.md) sweeps acquired live-site
cases in large frozen batches and follows new acquisitions/source revisions with
a configurable minimum, now 3,000, and a maximum of 10,000 cases per wave.
Automated audits and literal candidate staging have their own tracker
stage; they do not count as manual semantic review or qualified admission.

## Selection and admission

A search candidate needs an exact UUID/EIN bridge to a hashed IRS-BMF subsection03
observation and either a candidate URL or an exactly dated grant record. This is
a research pool, not qualified membership. A 501(c)(3) or private-foundation label
alone does not establish outgoing grantmaking, recent activity or fit.

A qualifying website candidate needs a recent successful observation of the
candidate URL (including a same-host redirect), usable content, an explicitly
labeled matching EIN without conflicting EINs, and outgoing funding language.
These mechanical gates produce **candidates pending semantic review**. A page
may quote another organization, describe an old program, or repeat footer text.
Such cases must abstain or retain a review dependency. No human approval is
created by a worker. Broader legal-entity bridges require separate source review.
HTTP success can contain a soft error or national/affiliate content, as the
Downey chapter follow-up demonstrates. Review candidate-specific page content
before applying a website; retain cached identity evidence and fresh failures
as separate dated observations.

The alternative giving route needs a payment/transfer actually made during the
window, attributable to the legal funder. On October 18, 2026 the window starts
October 18, 2025. Grant commitments, pledges, application awards, fiscal years,
filing dates and article publication dates cannot supply a missing payment date.
The GET-only `public.funding_events` observation selects positive `grant` rows
with exact dates, then retains source-payment and date-precision review. Missing
or absent event dates mean unknown recent giving, never inactivity. If the
response hits its 1,000-row cap, it is explicitly incomplete; paginate before
claiming comprehensive dated-record coverage.

Do not pad the target with missing-site organizations or unverified namesakes.
Show the search pool, candidate evidence, semantic verification and remaining
shortfall separately. Existing unknown-site discovery continues independently.

## The three website questions

| Question | Evidence recorded | Required limits |
| --- | --- | --- |
| Is the candidate URL live? | Requested/final URL, HTTP200 snapshot hash, observation time, usable same-host content | A seven-day observation window is triage freshness, not continuous uptime. Redirects to another host need identity review. Robots, TLS, HTTP denial and unacquired URLs remain blockers, not proof of a dead website. Parking/unrelated-content leads block website qualification. |
| Is the site up to date? | Page-scoped modified month/year, published month/year, exact metadata pointers or visible-text offsets | `site_last_updated_month` stays null without explicit site-wide evidence. A dated article does not date the whole site. Future dates, event dates, copyright years, acquisition time and HTTP Last-Modified do not establish editorial currency. No date means unknown. |
| Can an applicant evaluate fit and inquire? | Source spans for focus, geography, applicant eligibility, application posture and grant-inquiry guidance; source-linked contact-page candidates | Keyword presence is a review lead. Check actual requirements, exclusions, cycle and whether inquiries are welcome. A generic contact link is not permission to inquire, a donation form is not a grant application, and an invitation-only policy must be retained. |

[Publisher date metadata](https://developers.google.com/search/docs/appearance/structured-data/article)
provides article-level modification/publication dates. The freshness pass
recognizes explicit visible last-updated labels and supported
page/article modification/publication metadata. JSON-LD dates must identify the
same page URL, excluding dates belonging to embedded related articles. Metadata
is publisher-asserted and may be wrong. The recent-date bucket is a month-level
triage lead, not an exact twelve-month payment or currency determination. The
actual source month/year is retained for later interpretation. A page can be
live while freshness, funder role and inquiry readiness remain unknown.

## Private run and commands

Current revision: `data/research/active-funders-150k-2026-10-18/`.
Its `APPLICATION-BACKLOG.json` links prior pending preparations. `pool.json`
describes the search scope; content-hashed `pool-additions/` and `pool-revisions/`
retain each expansion. `verification.sqlite3` tracks local checkpoints.
`assessments/` preserves immutable source-linked outcomes, including uncertainty.
Responses, publisher excerpts, contacts and before-images are never public seeds.

```sh
funderdb research active-funders-init --source-run data/research/full-2026-10-17 --previous data/research/verification-150k-2026-10-18 --run data/research/active-funders-150k-2026-10-18
funderdb research active-funders-work --run data/research/active-funders-150k-2026-10-18 --follow
funderdb research active-funders-prepare --run data/research/active-funders-150k-2026-10-18 --org-id <organization-uuid>
funderdb research active-funders-recent-giving --run data/research/active-funders-150k-2026-10-18 --access data/research/supabase-read-access.json
```

The local worker follows existing saved crawler results. It has its own exclusive
lease, per-organization checkpoints and a 10 GiB disk guard. It performs no
network fetches or model calls. The existing crawler retains 16 workers, six-page
cap, shared host pacing, robots/TLS/public-IP/body-size checks and crash recovery.
Eligibility export uses the existing GET-only keyset/checkpoint mechanism.
Initializing again can append newly observed search candidates without deleting
prior membership or assessments. The search pool does not certify current tax
standing; source observation and underlying government vintage are distinct.

Assessments are research leads, not executable database changes. A proposed
profile enhancement uses the existing strict evidence proposal format with
literal source spans and scope/conflict fields. `active-funders-prepare` creates a single-case, source-hashed private review
workspace and bounded work item. It connects triage to the existing
`evidence-submit --run <proposal_workspace> --proposal <file>` validator without
altering the original cohort. General funding focus, geography, inquiry policy
and inquiry route can be organization-level claims without inventing a program
cycle. These are separate from cycle-specific application status/deadline claims.
The date metadata remains scoped triage evidence rather than a source-span
assertion in visible text.

Before constructing any update,
read and save the existing row, its exact expected state and proposed patch.
Unknown before-images stay explicitly unknown and block **that application**,
while independent research continues. Raw registrations, ledger reconciliation
and all live application belong in a separately requested session.

## Cost and later rule learning

Deterministic acquisition, hashes, dates and source locators run before model
interpretation. Keep large bodies out of extraction work items; preserve exact
source offsets so an abstaining cheaper model can use bounded context. This
worker's model-call count is zero; interactive agent token spend is not measured
by it and is not a claimed saving.

These are minimum operating gates. The original cohort's completed mechanical
pass does **not** trigger completion of the revised 150,000-funder verification.
After that actual cohort has been worked through, document detailed if/then
rules from reviewed cases and counterexamples, construct an independently
adjudicated frozen benchmark and holdout, and measure accuracy, false admission,
date/amount scope errors, abstention, review burden and actual cost. Version
rules and evaluate cheaper models before promotion. A recursive improvement
cycle must never use its own guesses as truth or promote rules/models without
review. No paid model batch, model switch or self-promoting automation is running.

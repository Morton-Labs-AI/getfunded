# Funder evidence cards

The demonstration at `/demo/evidence` separates a limited registry snapshot from
source-backed fit and inquiry guidance. Research uses the same
`funder-evidence-experience/v1` structure privately. A card is a presentation of
evidence and unknowns, not admission to the Qualified Funder Target List.

| Question | Record | Evidence limit |
| --- | --- | --- |
| Is the website live? | Usable public content and its actual observation time | One successful observation is not continuous uptime, legal identity or current grantmaking |
| Is it current? | Page-specific publication/modification evidence, named program and cycle | Preserve the publisher's precision. Copyright years, future events and crawl times do not date the whole website. Whole-site last-update month remains null unless independently established |
| Are we a fit? | Legal funder, program, applicant/payee, geography, exclusions, amounts and cycle | Separate individuals, schools, operating charities, fiscal sponsors, administering platforms and affiliated funds. Historical awards and assets do not imply current interest |
| How do we inquire? | Permitted route, required first step, invitation/LOI conditions and deadline | A contact link or Apply button alone does not establish permission or an open window. Closed named programs do not close every program |
| Why trust this? | Source URL, observed vintage, hashes, exact private locators and original interpretation | Keep publisher excerpts, raw pages, actual queries, contact data and before-images private. Licensing and human review remain separate gates |
| What remains uncertain? | Conflicts, missing terms, inaccessible sources and precise next research action | Preserve opposing notices and different amounts/dates. Unknown is not closed; an announcement is not proof of payment |

Every card carries `review_scope`, `before`, `after`, `status`,
`human_reviewed`, `remote_applied` and `published`. The before view identifies its
limited local registry scope. A dated database before-image is a separate private
attachment; it is not proof of today's remote state. The after view exposes
source provenance and page-scoped dates alongside the conclusions they support.

Two review scopes currently exist:

- **Automated source audit:** `review_scope` explicitly says semantic review is
  pending. `fit`, `program_posture` and `inquiry_next_step` are null. Extracted
  passages and contact links stay under `unreviewed_leads`; a mechanical EIN
  match or filing bridge is not semantic identity approval.
- **Bounded agent interpretation:** original notes explain the actual pages and
  context reviewed, supported fit/inquiry guidance and remaining holds. This is
  still not a full-site audit, human review, current IRS standing check or
  confirmation of a recent paid donation.

Strict candidate claims continue to use the existing `evidence-first/v1`
proposal path. Cards do not bypass exact source-span, named-program/cycle,
scope, supersession, duplicate, licensing or human gates. A literal statement
about a closed cycle must not become a general inquiry policy. Preserve a
misclassified preparation, attach an application hold and create a separate
typed revision only when its source supports the required fields.

For a **completed** frozen sweep, create a resumable private projection:

```sh
funderdb research evidence-cards \
  --run data/research/<active-run>/<bulk-run>/waves/<completed-wave> \
  --out data/research/<active-run>/<continuation>/bulk-evidence-cards
```

The command checks frozen membership, complete source-audit rows, immutable
assessment/review hashes, organization/result bridges and the dated before-image
baseline. It writes immutable per-organization cards plus a hashed manifest
under the private research root, with a 10 GiB disk guard and exclusive local
projection lease. A repeat resumes identical cards; differing output requires a
new vintage. It makes no network/model calls, research-step records, candidate
submissions, remote writes or approvals. Missing or blocked evidence stays
visible. This command does not re-fetch websites or certify their current state.

Count card projections, automated audits, distinct organizations, organization
rechecks, substantive interpretations, proposal records, repeated literal
observations, qualified funders, applied changes, human reviews and confirmed
profile publication separately. A card projection adds zero completed research
steps and zero new facts. Original public research commentary is separate from
publishing a confirmed funder profile.

Supabase remains read-only during research. Proposed application must retain
source hashes, exact expected state, existing before-images and
`awaiting_separate_application`. Fresh remote readback and live application
belong in a separately requested session. No pending write blocks independent
research.

This is an initial operating contract, not a validated cheap-model evaluation
suite or recursive learning system. The 150,000-funder qualification campaign
and the later detailed rules/evaluation phase remain incomplete. No measured
token-cost or speed improvement is claimed here.

Original implementation and documentation by Codex; human review pending.

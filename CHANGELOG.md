# Changelog

## 2026-10-19 — Resume the checkpointed 20,000-source continuation

Resume the existing guarded research processes after the requested pause,
preserving the full inventory, old evidence and separate duplicate counters.
Supabase remains read-only. Fix a saved-source extraction gap where malformed
navigation could hide explicit main content; new reviews identify the extraction
policy, and prior audits are preserved. One reproducing regression failed before
and passed after the fix under the escaped-bug exception; routine suites and CI
polling were not run. That resume checkpoint preceded the completed source batch
recorded below.

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are tagged `vX.Y.Z`.

## [Unreleased]

### Fixed

- Add versioned identity gates before active-funder/sweep candidate staging and
  explicit EIN-column table extraction, preserving legacy citations. Fresh
  validation reports directory false hints removed, conservative recall losses
  and extra extraction cost; broad scaling remains held.

- Version EIN labels and structural HTML text boundaries for new research packets,
  retaining legacy citation hashes and source-version-aware proposal validation.
  A separate 40-page evaluation recovers22/22 labelled identifiers versus17/22;
  discovery, duplicate and human-review counts remain separate.

### Added

- A frozen funder-focused40-case identity validation report separating EIN token
  recovery, directory/namesake/entity-scope errors, fit/inquiry guidance and cost.
  Scaling remains held; Supabase stays read-only and duplicate counts stay separate.

- The requested 20,000-source continuation completed with 98,664 page checks,
  private evidence cards, 274 bounded followup dispositions and separate duplicate
  counts. Original fit/inquiry findings retain unresolved identity and cycle holds;
  Supabase remains read-only and qualification/application remain pending.

- A requested-20,000 continuation panel separating completion-proof audits from
  waiting acquisitions, bounded interpretations and qualification, with attributed
  program research and private conflict/application gates.

- An in-progress next-10,000 evidence-format research report with 128 bounded
  followup dispositions, separate pending-wave and duplicate counts, and a local
  tracker readiness counter. Supabase remains read-only; no completion or human
  approval is inferred from source acquisition.

- A spreadsheet-style section comparison in the local Greenbook evidence demo,
  showing retained baseline fields, staged additions, source checks and open gaps.

- A private before/after evidence-card projection for completed source sweeps,
  preserving unknown fit/inquiry conclusions, dated sources, conflicts and
  separate audit, substantive-review, duplicate and application counts.

- A development-only Greenbook before/after evidence demonstration with three
  staged examples, program-fit and inquiry guidance, dated provenance, visible
  conflicts and open questions. Existing profiles remain unchanged; the demo
  makes no database or model calls.

- Another 10,000 funder-source audit report and 164 semantic/identity followup
  interpretations, with original attributed notes, source/scope holds and separate
  recheck, duplicate, qualification and application counts.

- A dated next-10,000 funder-source report, 13 cited-reference refreshes and
  19 semantic followup resolutions, with original attributed notes and separate
  organization-recheck, duplicate, candidate and human-approval counts.

- A selected-batch tracker panel separating terminal acquisition outcomes, access
  blockers and current-source audits from cumulative campaign counts. Completion
  remains separate from qualified funders, application and human review.
- A fixed 150,000-member IRS-subsection03 evidence campaign, deterministic saved-source
  integrity checks, exact-span candidate validation and a local tracker panel.
  Source checks, unresolved cases, staged claims and human approval remain distinct;
  research uses read-only remote access and makes no model calls in the evidence worker.
- Program-aware research link priority, 64 further performed website searches,
  five attributed website candidates, 26 review notes, and three first-party
  source definitions with 41 unreviewed announcement URL candidates. Cycle
  conflicts, namesake domains and acquisition blockers remain explicit.
- Full-population research through the existing read-only Supabase Data API,
  resumable hashed export shards, local latest-filing website selection, a
  concurrent crawler with shared host pacing and compressed evidence, and
  durable logs separating actual searches from suggested queries.
- Resumable organization research with an exhaustive inventory option, bounded
  public-web acquisition, per-organization coverage, hashed private snapshots,
  website-discovery amendments and a science-funder research/source compilation.
  Acquisition does not automatically confirm profiles or publish signals.
- 2026-10-08, audit record: the 300-pair recipient alias audit
  (`corpus/data/seed/er_labels/recipient_alias_audit_2026-10-08.csv` and its README) that gated
  the first alias apply. The labels were made by language-model agents, not people.
- 2026-10-08, data and profile additions:
  - **Backfill for 2017 to 2020.** `funderdb backfill` loads the IRS returns
    of index years 2017, 2018, 2019 and 2020, one zip file at a time.
  - **Open Foundation List.** `funderdb export foundations` writes a small
    public file set: one file of U.S. private foundations, one file of their
    fiscal years, and one grants file for each fiscal year. The website has
    a page and a guide for it.
  - **IRS standing.** The IRS Automatic Revocation of Exemption List and IRS
    Publication 78 data are loaded. A profile shows what the IRS lists say
    about an organization, with the date of each list, and search can hide
    automatically revoked organizations.
  - **Application history and new-recipient count.** A foundation's profile
    shows how it answered the application question on its earlier returns,
    and how many of its newest grant recipients are not on its grant lists
    for the three years before.
  - **Recipient links by filer consensus.** A grant row of a foundation is
    linked to an organization when three or more grant-making charities
    wrote that recipient name with one EIN. The Open Foundation List can
    mark these links in a `link_basis` column.
  - **Address from the latest return.** An organization that is not in the
    IRS master file gets the city, state and ZIP code that its newest return
    states. The street is not copied.
  - **Qualifying distributions repair.** The qualifying distributions value
    is now read from returns of older versions (before 2021v4.0) too, and
    `funderdb repair qualifying-distributions` fills it for returns that
    were loaded before.

## [0.1.0] - 2026-10-07

### Added

- Initial public release: corpus pipeline, web app, self-install.

[Unreleased]: https://github.com/Morton-Labs-AI/getfunded/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Morton-Labs-AI/getfunded/releases/tag/v0.1.0

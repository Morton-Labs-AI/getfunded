# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are tagged `vX.Y.Z`.

## [Unreleased]

### Added

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

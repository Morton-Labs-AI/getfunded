# Governance

This document says who decides what in GetFunded, and how.

## Roles

**Users** use the hosted service, self-install the app, or use the dataset.
Anyone can open issues and join Discussions.

**Contributors** have had a change merged: code, docs, data corrections, or
a new data source. Contributors sign off their commits (see
[CONTRIBUTING.md](CONTRIBUTING.md)).

**Maintainers** have merge rights. They review pull requests, triage issues,
cut releases, and enforce the code of conduct. Maintainers are listed in
[MAINTAINERS.md](MAINTAINERS.md).

**Steward** is Morton Labs. The steward holds the getfunded.ai domain, runs
the hosted service, and owns the GetFunded trademark. The steward appoints
the initial maintainers and acts as the final tie-breaker until a Steering
Committee exists.

## How decisions are made

### Lazy consensus

Most decisions happen on pull requests and issues. A change is accepted when
a maintainer approves it and nobody objects within a reasonable time
(usually 72 hours for anything non-trivial). Silence means consent.

If someone objects, discuss it on the thread. Most objections resolve there.

### Maintainer vote

These decisions need a vote of the maintainers:

- Breaking changes to the public schema, API, or CLI
- Adding a maintainer
- Removing a maintainer
- Changing the code license or the data license

A vote passes by simple majority of all current maintainers. Voting stays
open for 72 hours. Votes happen in a public issue unless the topic is a
person (then a private channel is fine, with the result posted publicly).

### Steering Committee

When three or more organizations have active maintainers, the maintainers
form a Steering Committee. It has one seat per organization. It takes over
the steward's tie-breaker role for technical decisions. The steward keeps
the domain, hosted service, and trademark.

Until then, the steward breaks ties.

## RFC process

Breaking changes need an RFC before code. Copy
[docs/rfcs/0000-template.md](docs/rfcs/0000-template.md) to
`docs/rfcs/NNNN-short-title.md` (next free number), open a pull request, and
leave it open for at least one week. Accepting the RFC is a maintainer vote.
Small changes and bug fixes do not need an RFC.

## Becoming a maintainer

Contribute for a while. Review other people's pull requests. When a current
maintainer nominates you, the maintainers vote. New maintainers are added to
[MAINTAINERS.md](MAINTAINERS.md) and to `.github/CODEOWNERS`.

Maintainers who are inactive for six months may be moved to emeritus by a
vote. Emeritus maintainers can return by vote.

## Code of conduct

Maintainers enforce [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Reports go to
conduct@mortonlabs.ai. A maintainer who is the subject of a report does not
take part in handling it.

## Non-negotiable data rules

Every change, from any contributor or agent, must respect these rules.
Reviewers must block changes that break them. Changing a rule itself
requires an RFC and a maintainer vote.

1. **Unknown is not closed.** If a filing does not state something, we show
   "Not stated in filings". We never show "closed" for an absent statement.
2. **Missing is not zero.** Missing data renders "Not available", never
   "$0".
3. **Contacts are opt-in and never vendor-sourced.** Contact channels are
   public only when `publishability = 'public'`. Vendor-sourced contacts are
   never public.
4. **Every fact has provenance.** Every fact row carries its source file
   hash (`raw_file_id`) and a record locator.
5. **AI output is labelled and cited.** AI-generated text is always marked
   as AI, cites evidence ids, and never asserts that a funder is interested.
6. **No fabricated data.** No invented rows. No demo data in production
   tables.
7. **Superseded filings are filtered.** Amended filings replace the
   original everywhere a filing is shown or counted.

## Changing this document

Edits to this document go through a pull request. Changes to roles, voting,
or the data rules need a maintainer vote.

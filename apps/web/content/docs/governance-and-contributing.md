---
title: Governance and contributing
description: Who decides what, the seven data rules every change keeps, and how to send a pull request.
group: developers
order: 4
---

# Governance and contributing

GetFunded is an open-source project with a steward. The full text is in [GOVERNANCE.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/GOVERNANCE.md) and [CONTRIBUTING.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/CONTRIBUTING.md). This page is the summary.

## Roles

- **Users** use the hosted service, self-install, or use the dataset. Anyone can open issues and join Discussions.
- **Contributors** have had a change merged. Contributors sign off their commits.
- **Maintainers** have merge rights. They review pull requests, triage issues, cut releases and enforce the code of conduct. They are listed in [MAINTAINERS.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/MAINTAINERS.md).
- **The steward** is Morton Labs. It holds the getfunded.ai domain, runs the hosted service and owns the trademark. It appoints the first maintainers and breaks ties until a Steering Committee exists.

## How decisions are made

- **Lazy consensus.** Most decisions happen on pull requests and issues. A change is accepted when a maintainer approves it and nobody objects within about 72 hours.
- **Maintainer vote** for breaking changes to the public schema, API or CLI; adding or removing a maintainer; changing a license. Simple majority, open for 72 hours, in a public issue.
- **Steering Committee.** When three or more organizations have active maintainers, they form a committee with one seat per organization. It takes over the steward's tie-breaker role for technical decisions.
- **RFCs.** Breaking changes need an RFC before code. Copy `docs/rfcs/0000-template.md`, open a pull request, leave it open for at least a week.

## The seven data rules

Every change, from any contributor or agent, keeps these. Reviewers block changes that break them. Changing a rule itself needs an RFC and a vote.

1. **Unknown is not closed.** An absent statement renders "Not stated in filings", never "closed".
2. **Missing is not zero.** Missing data renders "Not available", never "$0".
3. **Contacts are opt-in and never vendor-sourced.** Public only when `publishability = 'public'`.
4. **Every fact has provenance.** Every fact row carries its source file hash and a record locator.
5. **AI output is labelled and cited.** Always marked as AI, cites evidence ids, never asserts that a funder is interested.
6. **No fabricated data.** No invented rows. No demo data in production tables.
7. **Superseded filings are filtered.** Amended filings replace the original everywhere.

## Ways to contribute

- **Report wrong data** with the [data correction](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml) issue template. No code needed.
- **Report a bug** or **request a feature** with the issue templates.
- **Fix code or docs** with a pull request.
- **Add a data source.** Open an issue first describing the source, its publisher and its terms. Vendor and scraped sources are internal only.
- **Security problems** go through [SECURITY.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/SECURITY.md), never a public issue.

## Sending a pull request

1. Branch from `main`: `feat/<slug>`, `fix/<slug>`, `data/<source>-<slug>`, `docs/<slug>` or `chore/<slug>`.
2. Make the change small and focused. One topic per pull request.
3. Add a test for new behavior.
4. Run the checks:

   ```bash
   cd corpus && uv run pytest -q      # if you touched corpus/
   cd apps/web && npm run check       # if you touched apps/web/
   ```

5. Sign off every commit. We use the Developer Certificate of Origin, not a CLA:

   ```bash
   git commit -s -m "fix: render Not available for missing revenue"
   ```

6. List user-facing changes under `Unreleased` in `CHANGELOG.md`.
7. Open the pull request. A maintainer reviews within a few days. Expect questions about provenance and missing values.

## Working with an AI agent

Contributions written with AI help are welcome. The rules:

- A human reviews every line before it is pushed.
- A human signs off the commit. The sign-off name is the person who takes responsibility, never the agent.
- Say in the pull request that AI helped and roughly how.
- The seven data rules apply to agent output too.
- An agent must not add a data source without the issue and license review.

Each part of the repository has an `AGENTS.md` with the conventions that matter.

## Roadmap

The roadmap is a GitHub Project with three columns: Now, Next, Later. Anyone can propose an item by opening an issue or Discussion. Maintainers review the board in the first two weeks of January, April, July and October. The roadmap is not a promise or a release date. See [docs/governance/ROADMAP-PROCESS.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/docs/governance/ROADMAP-PROCESS.md).

## Code of conduct

Maintainers enforce the [code of conduct](https://github.com/Morton-Labs-AI/getfunded/blob/main/CODE_OF_CONDUCT.md). Reports go to conduct@mortonlabs.ai. A maintainer who is the subject of a report does not take part in handling it.

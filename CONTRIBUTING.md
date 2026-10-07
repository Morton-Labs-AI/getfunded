# Contributing to GetFunded

Thanks for helping. This guide covers setup, how we work, and what we check
before merging. Read [GOVERNANCE.md](GOVERNANCE.md) for who decides what,
and the **Non-negotiable data rules** in that file before you touch data.

## Ways to contribute

- **Report wrong data about a funder.** Use the
  [data correction](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml)
  issue template. You do not need to write code.
- **Report a bug** or **request a feature** with the issue templates.
- **Fix code or docs.** Open a pull request.
- **Add a data source.** See "Adding a data source" below.
- **Security problems:** read [SECURITY.md](SECURITY.md). Do not open a
  public issue.

## Repository layout

| Path | What it is | Stack |
|---|---|---|
| `corpus/` | Open Funder Database pipeline and SQL migrations | Python 3.12, uv, Postgres (Supabase) |
| `apps/web/` | getfunded.ai web app (marketing site, hosted product, self-install) | Next.js 16, TypeScript |
| `docs/` | Governance, RFCs, guides | Markdown |

## Set up

### Corpus

```bash
cd corpus
uv sync
cp .env.example .env        # fill in DATABASE_URL and keys you need
uv run funderdb --help
uv run pytest -q
```

Unit tests do not need a database. Ingest and eval commands do.

### Web

```bash
cd apps/web
npm ci
cp .env.example .env.local  # fill in what you need
npm run check               # typecheck + lint + unit tests + build
npm run dev                 # local server
```

`npm run check` is what CI runs. Run it before you open a pull request.

## Branches

Branch from `main`. Name the branch by type and a short slug:

- `feat/<slug>` new behavior
- `fix/<slug>` bug fix
- `data/<source>-<slug>` ingestion or data-source work
- `docs/<slug>` documentation only
- `chore/<slug>` tooling, dependencies, CI

Example: `data/990pf-schedule-b-skip`.

## Commits

### Sign-off (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. Every commit needs a `Signed-off-by:` line with your real
name and email. Git adds it for you:

```bash
git commit -s -m "fix: render Not available for missing revenue"
```

The sign-off says you wrote the change or have the right to submit it under
the project licenses (Apache-2.0 for code, CC BY 4.0 for data). CI checks
every commit in a pull request. Forgot? Run
`git rebase --signoff origin/main` and force-push your branch.

### Message style

[Conventional Commits](https://www.conventionalcommits.org/) are encouraged,
not required: `feat:`, `fix:`, `data:`, `docs:`, `chore:`, `test:`. Keep the
first line under 72 characters. Say what changed and why.

## Pull requests

Keep pull requests small and focused. One topic per PR.

Before you open one:

- [ ] `uv run pytest -q` passes (if you touched `corpus/`)
- [ ] `npm run check` passes (if you touched `apps/web/`)
- [ ] Every commit has `Signed-off-by:`
- [ ] You read the data rules and your change respects all seven
- [ ] New behavior has a test
- [ ] User-facing changes are listed under `Unreleased` in
      [CHANGELOG.md](CHANGELOG.md)
- [ ] Breaking changes have an accepted RFC (see GOVERNANCE.md)

A maintainer reviews within a few days. Lazy consensus applies: approval plus
no objections means merge. Expect questions about provenance and rendering
of missing values. That is normal here.

## Proposing a data correction

Funder data comes from government filings. We publish what the filing says.
If a profile looks wrong:

1. Open a
   [data correction issue](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml).
2. Tell us the funder name, the EIN or other identifier, the profile URL,
   what is wrong, and the source you checked.
3. We trace the fact to its source file hash and record locator.

Three outcomes are possible:

- **Our bug.** We parsed or rendered the filing wrong. We fix the code and
  re-run the ingest. The fix gets a test.
- **Stale filing.** A newer or amended filing exists. We ingest it. The
  older one is marked superseded and filtered.
- **The filing says that.** We leave the fact as filed and may add a note.
  We never edit a fact by hand to differ from the source record.

## Adding a data source

New sources must be public domain or carry terms that permit republication.
Vendor and scraped-website sources are internal only and never reach
`public.*` views. Before you write code, open an issue describing the
source, its publisher, its terms, and which facts you want to add.

A source lands in this order:

1. **Register the license** in `internal.licensing_map` (migration) with
   `republishable` set correctly.
2. **Stage the raw files.** Every input file (CSV, XML zip, API pull, seed
   file) is hashed with sha256 and registered in `internal.raw_files` before
   any parsing. Use the helpers in `corpus/src/funderdb/staging.py` and
   `ledger.py`.
3. **Parse into base tables** in the `internal` schema. Every fact row
   carries `raw_file_id` and `source_record_locator`.
4. **Filter superseded filings** if the source has amendments.
5. **Expose through `public.*` views** only via the `licensing_map` join.
   Contact channels need `publishability = 'public'` and a non-red privacy
   tier.
6. **Add tests** for the parser with a small fixture, and add eval cases if
   the source changes search or counts.
7. **Run the suite:** `uv run funderdb eval all` must pass with no new
   failures.
8. **Document it** in `corpus/README.md` and in the sources table in
   [DATA-LICENSE.md](DATA-LICENSE.md).

Real rows land before abstractions. Do not write the parser for source N+1
until source N passes its gate.

## Working with an AI agent

This repository ships `AGENTS.md` files (for example `apps/web/AGENTS.md`)
that coding agents read for local conventions. Keep them accurate when you
change a convention.

Contributions produced with AI assistance are welcome. The rules:

- A human reviews every line before it is pushed.
- A human signs off the commit. The `Signed-off-by:` name is the human who
  takes responsibility, never the agent.
- Say in the PR description that AI helped and roughly how.
- The data rules apply to agent output too. In particular: no fabricated
  rows, no demo data, no AI text that claims a funder is interested.
- An agent must not add a data source without the issue and the licence
  review above.

## Releases

Maintainers cut releases. Versions follow Semantic Versioning. Tag as
`vX.Y.Z`, move the `Unreleased` section of `CHANGELOG.md` under the new
version with the date, and publish a GitHub release from the tag.

## Licenses

Code you contribute is licensed under Apache-2.0 ([LICENSE](LICENSE)).
Data you contribute is licensed under CC BY 4.0
([DATA-LICENSE.md](DATA-LICENSE.md)). The GetFunded name and logo stay with
Morton Labs ([TRADEMARK.md](TRADEMARK.md)).

## Questions

Ask in [GitHub Discussions](https://github.com/Morton-Labs-AI/getfunded/discussions).
See [SUPPORT.md](SUPPORT.md).

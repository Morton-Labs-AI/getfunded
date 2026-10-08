# Open Funder Database — the `corpus/` pipeline

The Open Funder Database is a Postgres database of U.S. funders built only
from public-domain government records: IRS Form 990, 990-PF and Schedule I
e-file XML, the IRS Exempt Organizations Business Master File, SEC Form ADV
and Form D, and SBIR/STTR award data. Every fact row points back to the
sha256-hashed file it was parsed from and the exact record inside that file.
The database also carries a hybrid (keyword + vector) semantic search over
one document per funder, so a nonprofit can ask for "funders of work like
mine" and get an answer grounded in filings.

It is for nonprofits looking for funders, and for anyone who wants to build
on the data. This directory is the data half of the open-source GetFunded
monorepo: the Python `funderdb` command here builds and refreshes the
database, and the web app in `apps/web` reads it, read-only, to serve search
and funder profiles. Code is Apache-2.0 ([../LICENSE](../LICENSE)); the
published dataset is CC BY 4.0 ([../DATA-LICENSE.md](../DATA-LICENSE.md)).
How the two halves fit: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Install in 15 minutes

The full walk-through, written for non-developers, is
[docs/SELF-INSTALL.md](docs/SELF-INSTALL.md). The short version:

1. **Install uv** (it brings its own Python 3.12+):
   `curl -LsSf https://astral.sh/uv/install.sh | sh`
2. **Get a Postgres 15 or 16 with pgvector.** Local Docker:
   `docker run --name funderdb -e POSTGRES_USER=funderdb -e POSTGRES_PASSWORD=funderdb -e POSTGRES_DB=funderdb -p 5432:5432 -v funderdb-data:/var/lib/postgresql/data -d pgvector/pgvector:pg16`
   A hosted free-tier Postgres (500 MB) is enough for the small profile.
3. **Configure.** From this directory: `uv sync && cp .env.example .env`.
   Set `DATABASE_URL` in `.env` to a session-mode connection string (the
   loaders use `COPY`; a transaction pooler will not do). `SEC_USER_AGENT`
   is only needed later, for the SEC sources.
4. **Check the setup:** `uv run funderdb doctor`. Every line should read
   `OK` or `WARN`; a `FAIL` names exactly what to fix.
5. **Create the schema:** `uv run funderdb migrate` applies the 26 plain-SQL
   files `migrations/0000` to `0025` (`--dry-run` shows the plan first).
6. **Load the small dataset:** `uv run funderdb bootstrap --profile small`.
   It chains `migrate`, `ingest seed`, `ingest bmf`, `ingest filings` for the
   newest year, `ingest 990pf --limit 2000` and `status`. Your part is done
   here; the download and parse run on their own for 20–45 minutes and
   resume where they stopped if interrupted.
7. **Look around:** `uv run funderdb status`, then connect any SQL tool and
   query the `public.*` views described below.

Going further: `uv run funderdb bootstrap --profile full` loads every source
and every year (about 250 GB of staged IRS zips plus a 30–40 GB database,
several days, fully resumable). `uv run funderdb embed sync` builds the
semantic-search corpus and needs a `VOYAGE_API_KEY`; nothing else depends on
it. Re-running an ingest reuses cached downloads until they age out, then
stages a new file only if the bytes changed (`--refresh` checks now). After
pulling new code: `uv sync && uv run funderdb migrate`.

## Command reference

`uv run funderdb --help` lists the groups; `--help` on any command shows its
options.

| Command | What it does |
|---|---|
| `doctor` | Check Python, uv, Postgres extensions, `DATABASE_URL` reachability and disk space. |
| `bootstrap --profile small\|full` | One-command self-install: check env, migrate, run a sized ingest, print status. |
| `migrate` | Apply `migrations/*.sql` in order, recording each in `internal.schema_migrations` (`--dry-run`, `--to`, `--force`, `--baseline`). |
| `status` | Recent ledger runs, row counts and database size. |
| `stage bmf` | Download and hash-stage the four IRS BMF region CSVs; no database needed. |
| `ingest seed` | Curated federal agencies and funding programs from `data/seed/*.csv`. |
| `ingest bmf` | IRS Business Master File: the organization spine (`--all-orgs` for every exempt org). |
| `ingest filings` | Filings spine from the annual IRS index CSVs (no zips) plus the amended-return supersession sweep. |
| `ingest 990pf` | 990-PF officers and grants from the IRS bulk XML zips. |
| `ingest 990pf-detail` | 990-PF financials, officers, Schedule B and how-to-apply from already-staged zips; never inserts grant rows. |
| `ingest 990` | Public-charity Form 990 Schedule I grants. |
| `ingest 990-detail` | Form 990 core-form financials, Part IX program/admin split and Part VII compensation from staged zips. |
| `ingest websites` | Filer-stated websites from staged 990 and 990-PF XML. |
| `ingest adv` | SEC Form ADV daily firm feed: registered and exempt-reporting advisers. |
| `ingest adv-schedules` | SEC Form ADV monthly zips: Schedule A/B owners and 7.B.1 private funds. |
| `ingest formd` | SEC Form D quarterly data sets: Reg D offerings, issuers, related persons. |
| `ingest sbir` | SBIR/STTR award data: federal non-dilutive awards to small businesses. |
| `backfill` | Load older IRS index years (2017 to 2020) one zip at a time, safe on a small disk (`--dry-run`, `--discard-zips`, `--min-free-gb`, `--limit-zips`, `--forms`, `--finish`, `--parse-only ZIP`). |
| `refresh-views` | Rebuild the materialized views the app reads. Run it after a backfill. |
| `contacts sync-part-xv` | 990-PF Part XV application contacts into `contact_channels`, tiered (`--dry-run` classifies and counts only). |
| `contacts audit` | Publication invariants; every count must be 0. |
| `embed sync` | Rebuild the search documents and embed the ones whose hash changed (Voyage AI). |
| `resolve recipients` | Resolve grant recipients to organizations by EIN, then name+state tiers. |
| `resolve funds` | Link ADV private-fund records to Form D issuers (Splink). |
| `resolve people` | Dedupe people across sources, org-evidence-gated. |
| `resolve label` | Interactively label a fixed-size sample of candidate pairs for a job. |
| `resolve eval` | Precision gate for a job from its human labels (Wilson lower bound). |
| `resolve export-labels` | Export `internal.er_labels` to `data/seed/er_labels/<job>.csv` (CC BY). |
| `resolve backfill-overlap` | Recompute `people_overlap` on existing exact-name fund links without re-predicting. |
| `resolve status` | Per-job link counts, label counts, gate progress, canonical totals. |
| `eval all` | Run every benchmark series (`sql`, `semantic`, `er`). |
| `eval sql` | B-series SQL benchmarks from `benchmarks/queries.sql`. |
| `eval semantic` | E-series semantic and hybrid-search benchmarks (needs embeddings). |
| `eval er` | Entity-resolution precision floors. |
| `eval parity` | Spot-check filing financials against the ProPublica Nonprofit Explorer API (report only, needs network). |
| `export public` | Export the `public.*` views as a hash-stable, versioned CSV dataset (`--verify-only` runs the assertions and writes nothing). |
| `export foundations` | The Open Foundation List: two small CSV files of U.S. private foundations, read only from the `public.*` views (`--out DIR`, `--limit N`, `--no-ledger`). |

## Backfilling older years

The normal `ingest` commands load one year at a time and keep every zip. The
`backfill` command loads the older index years 2017 to 2020. It handles one
zip at a time, so it works on a machine with little free disk.

```
uv run funderdb backfill --dry-run                # the plan: zips, sizes, free disk
uv run funderdb backfill --discard-zips --limit-zips 1   # try one zip first
uv run funderdb backfill --discard-zips           # all four years, newest first
```

What it does for each zip:

1. It checks the free disk. It does not start a download that leaves less
   than `--min-free-gb` (default 6).
2. It downloads the zip (the download can resume) and records its sha256 in
   `internal.raw_files`, as every ingest does.
3. It loads the 990-PF grants, financials, officers, Schedule B, Part XV and
   websites that the zip holds. It reads the zip one time.
4. It writes one ledger row that starts with `backfill:`. A later run skips
   a zip that has this row.
5. With `--discard-zips` it deletes the local zip. The `raw_files` row keeps
   the sha256 and the source URL. `raw_files.meta` gets a `local_copy` note
   that says the copy was discarded and where to get it again.

After the last zip of a year it runs the amended-return sweep for that year.
At the end it prints four follow-up commands. It does not run them, because
they are slow and one of them costs money. `--finish` runs them in order.

Options: `--years 2020,2019` picks the years and their order. `--forms
990pf,990` also loads Form 990 core financials and Schedule I grants (much
more data). `--indexed-only` skips returns that are in a zip but in no index.
`--parse-only ZIP` parses one zip you already have and prints counts and the
schema-version coverage table. It needs no database.

Sizes: 36 zips, 13.0 GB in all, 0.42 GB for the largest. With
`--discard-zips` the extra disk in use stays under 1 GB. The file names, the
sizes and four facts about these old files are in
[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md). The steps for a small disk are
in [docs/SELF-INSTALL.md](docs/SELF-INSTALL.md).

A second run of a finished year adds no rows.

## Open Foundation List

The Open Foundation List is a small public download: every U.S. private
foundation in the database, in two CSV files.

```
uv run funderdb export foundations --out data/open-foundation-list
uv run funderdb export foundations --out /tmp/check --limit 300 --no-ledger   # a quick sample
```

It writes `DIR/<vintage>/` with:

- `foundations.csv.gz`: one row for each foundation (name, place, latest
  assets and giving, grants on file, application posture, public contact,
  link to the profile page);
- `foundation_years.csv.gz`: one row for each foundation and fiscal year;
- `README.md`, `LICENSE.txt` (CC BY 4.0 for the compilation; the IRS records
  are public domain) and `manifest.json` (row counts, sha256 of each file,
  sources, the git commit).

The export reads only the `public.*` views. It checks this before it writes a
file, and it checks that the contact columns come only from
`public.contact_channels`. Empty cells mean "not available", never zero.
`not_stated` does not mean "closed". The same database gives the same bytes.

`export public` is not changed by this command. Column dictionary and rebuild
steps: [docs/OPEN-FOUNDATION-LIST.md](docs/OPEN-FOUNDATION-LIST.md).

## What is in the database

### Two schemas

- **`internal.*`** is the base layer and is never exposed to an API. Core
  entities: `organizations`, `org_identifiers`, `people`, `relationships`,
  `funding_programs`, `funding_events`. The filing layer: `filings` (one row
  per indexed 990 or 990-PF), `filing_financials`, `filing_officers`,
  `filing_contributors`, `filing_application_info`, `org_website`. Contacts:
  `contact_channels`. Provenance: `raw_files`, `ingestion_ledger`,
  `licensing_map`, `schema_migrations`. Entity resolution: `entity_links`,
  `er_labels`, `recipient_matches`. Search: `search_documents`. Internal-only
  enrichment: `org_web_facts`. Materialized views `internal.mv_*` hold the
  rollups the app reads (latest financials, application posture, totals), and
  the functions `internal.hybrid_search` and `internal.similar_orgs` serve
  search.
- **`public.*`** is 14 views, the publishable projection. Each joins
  `raw_files → licensing_map` and keeps only rows from republishable files:
  `organizations`, `org_identifiers`, `people`, `relationships`,
  `funding_programs`, `funding_events`, `filings`, `filing_financials`,
  `filing_officers`, `filing_contributors`, `filing_application_info`,
  `org_application_posture`, `org_financial_series`, `contact_channels`.
  These are what you query and what the export reads.

### Data classes

| Class | Values and notes |
|---|---|
| Organization types | `private_foundation`, `public_charity`, `investment_adviser` (classified `vc` or `pe` where the schedules support it), `fund`, `company`, `gov_agency`; reserved: `family_office`, `angel_group`, `accelerator`, `corporate_vc`, `other`. |
| Funding events | `grant` (990-PF Part XV and 990 Schedule I), `grant_commitment` (approved for future payment), `sbir_award`, `sttr_award`, `reg_d_offering`; reserved: `federal_grant`, `federal_contract`, `equity_investment`, `other`. |
| Filings | one row per indexed return: object id, EIN, return type, tax period, DLN, batch, amendment state. Financial lines, officers (corporate trustees kept apart from people), Schedule B contributors, Part XV application info and the filer-stated website hang off it. |
| People and relationships | officers, trustees, owners, executives, related persons, PIs and points of contact as reported per source; `owner_of`, `executive_of`, `manages_fund`, `adviser_to` edges. |
| Contact channels | emails, phones and web forms, each with a privacy tier and a publishability flag (below). |
| Search documents | one text document per foundation, adviser, company and program, with filter columns and a 512-dimension embedding. |

### Doctrines the data obeys

1. **Unknown is not closed.** Application posture is `open`,
   `preselected_only` or `unknown`. `unknown` means the return carries no
   Part XV statement at all; every grantmaking public charity is `unknown`
   because Form 990 has no Part XV. No view, export or ranking may treat it
   as a refusal.
2. **Missing is not $0.** `NULL` means the line is absent from the return;
   `0` means the filer reported zero. The two are never coalesced.
3. **Superseded filings are filtered.** An amended return gets a new object
   id; within one (EIN, return type, tax period) the greatest object id is
   the live filing. Losers keep their detail rows (still viewable) but lose
   their funding events (never double-counted). Per-year aggregates filter
   `superseded_by_object_id is null`.
4. **Contacts publish by affirmative act.** `contact_channels` carries
   `privacy_tier` (`green` role desk, `yellow` professional contact from a
   filing, `red` never) and `publishability` (`public` or `internal_only`,
   default internal). The public view requires `public`, not `red`, and a
   republishable licence. Role inboxes such as `grants@` publish; a named
   person's address is withheld by policy, not by absence.
5. **Vendor and scraped facts are never republished.** Files licensed
   `vendor_internal_only` or `publisher_website` cannot reach a `public.*`
   view, a trigger refuses to mark their contacts public, and the export
   asserts that no public view reads `org_web_facts`.

## Data sources

URLs, cache policy and the known limits of each source:
[docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

| Source | Publisher | What we take | Cadence | Licence |
|---|---|---|---|---|
| EO Business Master File | IRS | identity, address, subsection, foundation code, NTEE, asset/income/revenue | ~monthly | public domain |
| Form 990 / 990-PF e-file index and XML | IRS | filings spine; 990-PF officers, grants, 51 financial lines, Schedule B, Part XV; 990 Schedule I grants, core financials, Part IX split, Part VII compensation; filer websites | index through the year, zips in batches | public domain |
| Form ADV daily feed | SEC | registered and exempt-reporting advisers, AUM, private-fund flag | daily | public domain |
| Form ADV monthly filing zips | SEC | Schedule A/B owners and executives, 7.B.1 private funds, vc/pe classification | monthly | public domain |
| Form D quarterly data sets | SEC | issuers, Reg D offerings, related persons | quarterly | public domain |
| SBIR/STTR awards | SBA | awardee companies, awards, PIs and contacts (internal only) | irregular | public domain |
| Federal agencies and programs | this project | 10 agencies, 16 non-dilutive programs | by pull request | CC BY 4.0 |
| Entity-resolution labels | this project | human match / not-match decisions | by pull request | CC BY 4.0 |

The SEC sources require `SEC_USER_AGENT` naming your organisation and a
contact address, and refuse to run without it.

## Coverage and scale: one reference deployment (2026-08)

These are measured numbers from one full-profile deployment in August 2026.
They describe what that database held, not what every install will hold or
what the pipeline promises: your counts depend on which sources and years
you load and on what the IRS has published by then.

| | Measured |
|---|---|
| Organizations | 2.26M exempt organizations (full BMF spine); 145,200 private foundations with a parsed 990-PF; 23,638 SEC advisers; 180,174 private funds; 68,890 companies |
| Filings | 2.56M indexed (675,806 990-PF + 1,881,691 990); 2,443,977 parsed with financials, which was 100% of returns whose XML the IRS had published; 113,520 indexed returns had no XML yet |
| Officers | 22.0M `filing_officers` rows; officers present on 100% of parsed filings |
| Funding events | 14.6M rows at the mid-year inventory (990-PF grants, Form D offerings, SBIR/STTR awards); the Schedule I load then added 4.15M public-charity grant rows (81% recipient-EIN-resolved), the 2024 990-PF year 1.7M, and future commitments 181,551 |
| Other filing detail | 258,763 Schedule B contributor rows; 411,840 Part XV application rows; 294,416 organizations with a filer-stated website |
| Application posture | of 145,200 foundations: 26,864 open, 101,773 preselected only, 16,563 unknown |
| Public contacts | 832 role inboxes and 30,547 phones published; 6,742 named individuals withheld |
| Search documents | 249,722 (191,616 foundations, 23,626 advisers, 34,464 companies, 16 programs), voyage-3.5 at 512 dimensions, HNSW index |
| Export | 47.3M rows across 55 gzipped CSV files, 2.9 GB |

## Provenance and licensing

Every fact traces back along one chain:

```
dataset name → source URL → sha256-hashed immutable file → licence code
            → ingestion-ledger run → row (raw_file_id + source_record_locator)
```

- `internal.raw_files` has one row per distinct file ever ingested, keyed by
  sha256, with its licence code and three separate timestamps (fetched,
  publisher last-modified, parsed), so a re-parse can never make old data
  look fresh. Staged files live under `data/raw/<dataset>/<sha256[:12]>_<name>`
  next to a `.meta.json` and an append-only `manifest.jsonl`.
- Every fact row carries `raw_file_id` and `source_record_locator`
  (`row:EIN=…`, `row:CRD=…`, or an element path inside the 990 XML).
- `internal.licensing_map` decides republication once per file:
  `us_public_domain`, `cc0`, `cc_by` and `odbl` pass; `community_unverified`,
  `vendor_internal_only` and `publisher_website` never do.

Full description: [docs/PROVENANCE.md](docs/PROVENANCE.md). Licence terms
and the attribution line for reuse: [../DATA-LICENSE.md](../DATA-LICENSE.md)
(the compilation is CC BY 4.0; the underlying government records are public
domain and need no credit).

### Export

```
uv run funderdb export public --verify-only   # the seven boundary assertions, no files
uv run funderdb export public                 # writes data/export/<vintage>/
```

The seven assertions (X1–X7) run before any byte is written: every exported
contact is an intended public row; none comes from a non-republishable file;
no public email belongs to a named individual; `filing_application_info`
exposes no email or phone column; every exported relation is a `public` view;
no exported view reads `org_web_facts`; and the public contact count equals
the internal count of public rows. One failure aborts with a nonzero exit.
Files are written with `COPY … ORDER BY <unique key>` and gzip `mtime=0`, so
a re-run is byte-identical. `manifest.json` is written last and records
per-file hashes, record counts, per-source licences, the assertion results,
the git commit and the newest applied migration. `people` and
`relationships` are not exported until people entity resolution certifies.

## Evaluation and tests

```
uv run pytest -q              # unit tests, no database needed, under a second
uv run funderdb eval all      # benchmark suite, needs a loaded database
```

The unit tests cover the 990-PF and Schedule I parsers, the migration runner
(numbering, uniqueness, every granted role exists, hash conflicts), staging
vintage and refresh rules, export record counting, the CLI and `doctor`.

`eval all` runs three series. `sql` executes `benchmarks/queries.sql`
verbatim (an append-only record; assertions live in
`benchmarks/expectations.py`). `semantic` checks hybrid-search behaviour and
needs embeddings. `er` checks entity-resolution precision floors; it reports
SKIP until a link job is applied, and a forced, uncertified apply reads as
FAIL. `eval parity` compares filing financials with an outside reference and
never gates: the IRS filing is the source of truth.

Before tagging a release, replay the migrations from zero against an empty
pgvector Postgres ([docs/MIGRATIONS.md](docs/MIGRATIONS.md)). That is the
only proof that the files, not just a live database, describe the schema.

## Known limits

- **Entity resolution is not applied.** ADV-side and Form D-side records of
  the same fund are separate organizations and `canonical_org_id` is unset.
  The funds link job ran its precision gate and did not certify (227 of 252
  labelled pairs matched; Wilson lower bound 0.858 against a 0.90 bar), so
  nothing was applied. People are per-source, which is why `people` and
  `relationships` stay out of the export. Recipient resolution (EIN, then
  name+state tiers) has run on 990-PF grants; 81% of Schedule I rows resolve
  by EIN and the rest keep the as-reported text with a NULL recipient.
- **Not ingested:** 990-EZ, 990-N, 990-T, paper returns, Publication 78,
  auto-revocations and determination letters. Highest-paid-employee and
  contractor compensation tables are parsed but not stored.
- **Grants-paid totals are 990-PF only.** The 990 pass does not extract
  Part IX line 1, so `total_grants_paid` and giving-ranked views cover
  foundations only.
- **The IRS zip backlog.** At any time tens of thousands of indexed returns
  have no published XML. They sit in the filings spine with nothing attached
  and are picked up by a later run.
- **Back-year 990-PF grant rows** are loaded for the index years you ran.
  `funderdb backfill` loads 2017 to 2020 one zip at a time. Two gaps stay:
  the 2016 zips are gone from the IRS host, so about 18,700 990-PF rows of
  the 2017 index have no XML; and index years before 2017 are not published.
- **Qualifying distributions on returns loaded before the 2026-10 parser
  fix.** The Part XII group has an older name in schema versions before
  2021v4.0. Returns of those versions that were already loaded (about
  127,700) have an empty `qualifying_distributions`. New loads fill it. The
  old rows need a repair pass.
- **Form D** names the issuer, never the investors, so it is not a deal
  graph. Offerings whose first sale is yet to occur have a NULL event date,
  and a few filer-entered absurd amounts survive in the tail.
- **Coverage inside parsed 990-PFs:** Schedule B is present on 24% of
  filings; Part XV application information is actionable (a contact,
  materials or a deadline) on 23%, most of the rest stating only that the
  foundation funds preselected organizations.
- **No pixel-faithful filing render.** The app's filing page is a structured
  reconstruction from parsed fields plus the original XML, not the IRS MeF
  stylesheet output.
- **Keyword search matches names and titles only,** so a topic word also
  hits unrelated organizations with that word in their name. Semantic search
  needs the optional embedding step.
- **Public views on hosted Postgres.** The `public.*` views are owner-rights
  filtered views. On a host that auto-exposes the `public` schema through a
  data API, migration 0024 revokes write-shaped grants from the API roles and
  keeps SELECT on purpose; every new `create view public.*` must repeat that
  revoke. Rate limiting of that anonymous API belongs to the app, not here.

## Engineering history

Lessons kept from the build-out, each the result of a real defect.

- **Amended returns supersede.** An amendment gets a new object id, so a
  naive load keeps both copies and double-counts every grant. The index's
  submission date is unusable for ordering (year-only in some years, garbage
  timestamps in others); the greatest object id wins. Losers lose their
  funding events and keep their detail rows, and the benchmark suite asserts
  both invariants at zero.
- **Posture comes from the latest PARSED filing, never the latest filing.**
  Letting an indexed-but-never-packaged filing win mislabelled about 3,800
  open foundations as unknown and more than doubled the unknown count. The
  same rule governs filer-stated websites.
- **`mail` and `email` name a medium, not a role.** The first contact load
  published an address of the form `<initial><surname>.email@…` as a role
  inbox because `email` matched as a token. The classifier now accepts those
  words only as a whole local part, and the loader's upsert scopes its
  `do update` to rows it owns so a re-run can downgrade a published row;
  `do nothing` would have frozen the mistake forever.
- **The `NOT IN` / coalesce prune trap.** Pruning stale search documents with
  a row-constructor `NOT IN` deleted nothing, because one key column is NULL
  for every document kind and the comparison yields NULL. `is not distinct
  from` has the right semantics but is not joinable, so the planner
  nested-looped a 191k-row temp table past the statement timeout. The
  working form is equality over a `coalesce` nil-UUID sentinel plus `ANALYZE`
  on the temp table (it has no statistics otherwise). The prune refuses above
  a 1% ceiling so a degenerate builder cannot cost a full re-embed.
- **Filtered vector search needs an exact leg.** HNSW post-filtering
  silently returned zero results for minority document kinds under a filter,
  so `hybrid_search` runs an exact vector scan for filtered queries. The
  semantic benchmark caught it.
- **Export determinism.** `GzipFile` writes the source filename into the gzip
  header, so a file's sha256 depended on what it was called. Fixed with
  `filename=""` and `mtime=0`, verified in the strong form: identical content
  under different names yields the identical digest.
- **Filer-entered numbers need headroom.** A Schedule B contributor number
  overflowed `smallint` on first contact with real data. Assume any
  filer-controlled numeric can be absurd; the parser clamps out-of-range
  values to NULL.
- **Trust the query, not the design.** A materialized view the loader never
  refreshed left 878,130 parsed charity filings invisible to the browse
  screen; running the documented query found it. One benchmark clause is
  written to break when a planned extension lands, so stale copy must change.
- **Bulk loads want a session connection.** Transaction poolers can kill
  long `COPY` streams mid-run. Every long ingest is chunk-committed and
  re-entrant, so a killed run resumes at no cost; wrap backfills in a bounded
  retry loop rather than watching them.

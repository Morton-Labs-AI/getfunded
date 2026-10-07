# Provenance

The database makes one promise: every fact traces back to a file you can
re-download, re-hash and re-parse. This page explains the pieces that keep
that promise and the three doctrines that decide what a row is allowed to
mean.

```
dataset name -> source URL -> sha256-hashed immutable file -> licence code
            -> ingestion-ledger run -> row (raw_file_id + source_record_locator)
```

## raw_files: the file registry

`internal.raw_files` has one row per distinct file ever ingested.

| column | meaning |
|---|---|
| `dataset_name` | which source (`irs_eo_bmf`, `irs_990_xml`, `sec_form_adv`, …; see `docs/DATA-SOURCES.md`) |
| `source_url` | where the bytes came from (NULL for hand-staged files; never overwritten with NULL) |
| `storage_path` | `data/raw/<dataset>/<sha256[:12]>_<name>` |
| `sha256` | the file's hash; **unique** — the same bytes are one row however often they are seen |
| `byte_size`, `content_type` | |
| `license_code` | FK to `licensing_map`, declared once at staging time, inherited by every row parsed from the file |
| `as_of_date` | the file's vintage as a date (feed date, Last-Modified date, or fetch date) |
| `fetched_at` | when *we* downloaded these bytes (0025) |
| `source_last_modified` | the publisher's `Last-Modified` for these bytes, if sent (0025) |
| `parsed_at` | the most recent ingest run that parsed this file (0025) |
| `downloaded_at` | legacy; equals `fetched_at` for new rows |
| `meta` | free-form JSON (`curated_by`, etc.) |

The three timestamps are deliberately separate. Re-ingesting a file fetched
in July advances `parsed_at` and nothing else, and loaders stamp
`last_verified_at` on organizations from the file's vintage
(`source_last_modified`, else `fetched_at`) — never from the clock. A
re-parse therefore cannot make old data look freshly verified.

### Staging on disk

Every download lands in `data/raw/<dataset>/` under a name that starts with
the first 12 hex characters of its sha256. Next to it:

- `<file>.meta.json` — the same vintage fields as the registry (`fetched_at`,
  `source_last_modified`, `etag`, `checked_at`), so staging is auditable
  before a database exists and so conditional refreshes know what to send;
- `manifest.jsonl` — an append-only log of every file ever staged there.

A cached file is re-hashed on every use. If the bytes no longer match the
hash in its own filename it is renamed `.corrupt_<name>` and downloaded
again; corruption is never silently accepted as a new version.

Mutable feeds (same URL, new bytes over time) keep every vintage on disk. A
refresh that finds new bytes stages a *new* file with a new hash; the old one
stays, and stays registered, because rows were parsed from it.

## Record locators

Every fact row carries `raw_file_id` and `source_record_locator`, which
together point at the exact place in the exact file:

| source | locator form | example |
|---|---|---|
| BMF CSV | `row:EIN=<ein>` | `row:EIN=742961304` |
| ADV feed | `row:CRD=<crd>` | `row:CRD=162946` |
| seed CSVs | `row:slug=<slug>` | `row:slug=doe-sbir` |
| 990 XML | XPath-like element path inside `<OBJECT_ID>_public.xml` | `…/SupplementaryInformationGrp/GrantOrContributionPdDurYrGrp[3]` |
| filings | `row:object_id=<object_id>` | |

Funding events additionally carry `source_record_key`, a stable key used
for idempotent upserts: `irs990pf:<object_id>:grant:<n>`,
`irs990pf:<object_id>:futgrant:<n>`, `irs990:<object_id>:schedi:<n>`,
`seed:<slug>`, and a content hash for SBIR awards.

High-volume rows (BMF organizations, all funding events) do **not** store a
copy of their source record (`raw_source` is NULL): the hashed file plus the
locator *is* the provenance, and the copy would cost more than the data.
Low-volume rows (seed, ADV firms) keep a compact extracted `raw_source`.

## Ingestion ledger

`internal.ingestion_ledger` has one row per run of a loader over a file:
`raw_file_id`, `dataset_name`, `status` (`running` / `completed` / `failed`),
`started_at`, `completed_at`, `rows_inserted` / `updated` / `skipped`, and
free-text `notes` (which now record the file's vintage and whether it came
from cache). `funderdb status` prints the most recent runs. Exports are
ledgered too: the manifest of every published export is staged, hashed and
registered under dataset `export_public`.

## licensing_map and what it decides

`internal.licensing_map` is the single table that says what may be
republished. Licence is a property of the **file**, inherited by rows.

| code | republishable | attribution | used for |
|---|---|---|---|
| `us_public_domain` | yes | no | IRS filings and BMF, SEC EDGAR/ADV/Form D, SBIR/STTR |
| `cc0` | yes | no | reserved (e.g. Crossref Open Funder Registry) |
| `cc_by` | yes | **yes** | the curated seed files, ER labels, the export compilation |
| `odbl` | yes | **yes** | reserved |
| `community_unverified` | **no** | — | community data whose terms are unconfirmed |
| `vendor_internal_only` | **no** | — | commercial enrichment, contractually barred from republication |
| `publisher_website` | **no** | — | funder website snapshots (0012) |

Two consequences are structural, not procedural:

1. Every `public.*` view joins `raw_files -> licensing_map` and filters
   `where lm.republishable`. A row from a non-republishable file cannot
   appear in a public view, whatever its other columns say.
2. The export (`funderdb export public`) reads only `public.*` views, runs
   seven boundary assertions before writing a byte, and labels licensing
   **per source dataset** in `manifest.json` (`licensing.sources`). The
   compilation is CC BY 4.0; an upstream `cc_by` or `odbl` source keeps its
   own licence and its attribution requirement. Accepting an attribution
   licence never relicenses that source.

## Publishability tiers for contacts

`internal.contact_channels` is the only table that can publish a person's
reachable address, so it carries two independent flags:

- `privacy_tier` — `green` (a role desk such as `grants@`), `yellow`
  (a professional contact disclosed in a government filing),
  `red` (never publishable; a CHECK forbids `red` + `public`);
- `publishability` — `public` or `internal_only`, **defaulting to
  `internal_only`**. Publishing is an affirmative act.

A trigger refuses `publishability = 'public'` for any row whose file licence
is not republishable, so vendor data cannot be published by mistake. The
public view applies a triple filter: `publishability = 'public'`,
`privacy_tier <> 'red'`, and a republishable licence.

The classification rule for e-mail addresses is SQL
(`internal.is_role_based_email`, 0018) rather than Python, so the loader,
the benchmarks and any reviewer apply the identical rule. `grants@` and
`info@` are desks and publish; `firstname_lastname@` is a person and is
withheld. Withheld addresses exist in the private schema **by policy, not
by absence**; they are never exported.

`funderdb contacts audit` checks the invariants (every count must be 0),
and export assertions X1-X3 and X7 re-check them before every export.

## Doctrine: "unknown is not closed"

A foundation's application posture
(`public.org_application_posture.application_posture`) is tri-state:

- `open` — its latest parsed 990-PF carries a Part XV application block;
- `preselected_only` — Part XV says it only contributes to pre-selected
  organizations;
- `unknown` — the return has **no** Part XV block at all.

`unknown` is the absence of a statement, not a refusal. Every grantmaking
public charity is `unknown`, because Form 990 has no Part XV. Treating
`unknown` as `closed` would silently remove most of the funding universe
from a search, so no view, export or ranking may do it. The same rule
applies to financial lines: NULL means the line is absent from the return,
`0` means the filer reported zero, and the two are never coalesced.

## Doctrine: supersession

Filings are immutable: an amended return gets a **new** `object_id`. Within
one `(ein, return_type, tax_period)` the filing with the greatest
`object_id` is the live one (object ids are fixed-width and start with the
IRS processing date, so text `max()` is the latest; `SUB_DATE` in the index
is unusable for ordering). The reconciliation sweep at the end of every
990 ingest:

1. sets `superseded_by_object_id` on the losers (and repairs stale pointers
   if a later index reveals a newer winner);
2. **deletes** the losers' `funding_events` rows — they feed every aggregate
   surface and a filter-everywhere approach leaks; they are recoverable by
   re-parsing the staged zip;
3. **keeps** the losers' `filing_financials`, `filing_officers` and
   `filing_contributors`, so the original return stays viewable.

Downstream consumers filter `superseded_by_object_id is null` for per-year
aggregates. The benchmark suite asserts both invariants at zero: no
superseded filing retains event rows, and no group keeps two live filings.

A related gate governs entity resolution: predicted links between records
(funds, people) are never applied to the canonical map until a fixed-size
human-labelled sample certifies precision (Wilson lower bound above the
job's bar). A `--force` apply is possible and is recorded as provisional.
Two different people who share a name never auto-merge on the name alone.

## Exports as provenance artifacts

`funderdb export public` writes `data/export/<vintage>/` with:

- one `.csv.gz` per public view (funding events sharded by fiscal year),
  produced by `COPY … ORDER BY <unique key>` with gzip `mtime=0` so a
  re-run is byte-identical;
- `manifest.json`, written **last** before the directory is renamed into
  place: compressed and uncompressed sha256 per file, CSV record counts
  (quoted newlines are field content), the source datasets each file
  derives from, per-source licences, the boundary assertion results, the
  git commit and the newest applied migration;
- `LICENSE` and `README.md` for the export;
- `LATEST`, in the parent directory, naming the newest vintage.

A published export can therefore be verified by anyone with the same
database: re-run, compare hashes.

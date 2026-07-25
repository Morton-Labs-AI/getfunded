# Open Funder Database

Open, agent-maintained database of funders for deep-tech and public-benefit
companies: private foundations (IRS 990/990-PF), VC/PE (SEC Form ADV, Form D),
and federal non-dilutive programs (SBIR/STTR + curated seed) — built on a
public-domain data spine so the core dataset is legally republishable.

**Design principle (from the July 2026 research study):** aggressive in
acquisition, conservative and rules-driven in republication. Paid enrichment
(Stage 3) is internal-only, enforced structurally:

- Base tables live in the `internal` Postgres schema — never exposed via API.
- `public.*` views filter through `raw_files → licensing_map`; only
  `republishable` sources pass; contact channels additionally require explicit
  `publishability = 'public'` and a non-`red` privacy tier.
- A trigger makes vendor-sourced contact data impossible to mark public.
- File-first ingestion: every input (bulk CSV, XML zip, API pull, hand-curated
  seed) is sha256-hashed and registered in `internal.raw_files` before parsing.
  Every fact row carries `raw_file_id` + `source_record_locator`.

Database: Supabase project `open-funder-db` (ref `poznaikbjcgnthfmqueo`).
Schema: [migrations/](migrations/) (plain SQL, applied via Supabase MCP).

## Anti-ceremony rules

The April 2026 predecessor produced 60 files and zero rows. Inverted here:

1. Real rows land before abstractions. Source N+1's code is not written until
   source N's verification gate passes.
2. No file is created before the next data-touching task needs it.
3. If a gate slips >2 days, shrink the data slice — never retreat into
   refactoring or schema redesign.

## Phase-1 gates

| Gate | Content | Status |
|---|---|---|
| G0 | Supabase project + schema (10 tables, 7 views) + smoke-verified upsert/guard SQL | ✅ 2026-07-25 |
| G1 | IRS EO BMF private foundations (~135k orgs, EIN crosswalk) | ✅ 2026-07-25 — 134,927 loaded (exact), 0 provenance orphans, rerun-idempotency proven at scale |
| G2 | Curated federal agencies + programs seed (10 agencies, 16 programs) | ✅ 2026-07-25 — B1 fusion query returns all 7 expected programs |
| G3 | SEC Form ADV firms, RIA + ERA (+ Schedule A/B people, 7B1 funds) | — |
| G4 | IRS 990-PF XML 2025–26: officers + grants-paid | — |
| G5 | SEC Form D 2024–26 offerings | — |
| G6 | SBIR/STTR awards (~250k) | — |
| G7 | Benchmark suite passes ([benchmarks/queries.sql](benchmarks/queries.sql)) | — |

## Running

```
uv sync
cp .env.example .env       # add DATABASE_URL (Supabase session pooler, port 5432)
uv run funderdb stage bmf              # download + hash-stage (no DB needed)
uv run funderdb ingest bmf --dry-run   # parse + count locally (no DB needed)
uv run funderdb ingest bmf             # load foundations
uv run funderdb ingest seed            # load federal agencies + programs
uv run funderdb status                 # ledger + row counts
```

## Benchmark results

_Populated at G7. Ten queries in [benchmarks/queries.sql](benchmarks/queries.sql):
federal non-dilutive discovery, named VC/philanthropic target resolution
(Prelude, Lowercarbon, Schmidt, Stellar Energy), FTS discovery queries,
grants-paid evidence, recent Reg D raisers, provenance round-trip._

## Operational notes

- **Connection**: use the direct host `db.poznaikbjcgnthfmqueo.supabase.co` (IPv6)
  for bulk loads. The session pooler intermittently kills large COPY streams
  with `SSL error: bad record mac`.
- **Size policy**: `raw_source` JSONB is stored only on low-volume rows (seed,
  future ADV firms); BMF foundations and all funding_events carry locator +
  hashed staged file instead (measured 2026-07-25: raw_source on 135k BMF rows
  cost ~150MB of a 500MB free-tier budget).

## Provenance contract

Every fact traces to: dataset name → source URL → sha256-hashed immutable file
→ license code → ingestion-ledger run. Curated seeds are CC-BY (our original
compilation); government filings are U.S. public domain. Seed-file award
figures and URLs are curated estimates pending founder review.

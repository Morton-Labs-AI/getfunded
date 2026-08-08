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

## Phase-2 gates (status 2026-08-08)

| Gate | Content | Status |
|---|---|---|
| G0 | Re-ingest + baseline on grown DB | ✅ |
| G1 | Hybrid semantic search (148k-doc corpus, voyage-3.5@512, HNSW, `internal.hybrid_search`) | ✅ + **0011 regression fix**: filtered queries take an exact vector leg (HNSW post-filtering had silently zeroed minority-kind results; caught by `funderdb eval semantic`) |
| G2 | 990-PF back-years | 🟡 2024 complete (126,982/126,982 indexed filings — zero missing; +1.7M grants); 2023/2022/2021 gated on the 16GB disk bump |
| G3 | Full BMF exempt spine (2.26M orgs; never-demote-a-grantmaker) | ✅ |
| G4 | Entity resolution | 🟡 recipients tiers 1–3 applied (886,763 grant rows); **funds gate RAN and FAILED** 2026-08-08 — 252 labels, 227/252 match, Wilson low 0.858 vs the >0.90 bar, so the `splink:% + gamma_people>=1` class is **not certifiable as defined**; no apply ran (`canonical_org_id` still 0), 25 human `not_match` pairs recorded as `rejected`, all 254 labels exported CC-BY; a tighter class needs a fresh stratum + fresh fixed-n sample; people job BUILT (org-evidence-gated auto-accept, the Eric Schmidt rule enforced twice), still downstream of a funds apply |
| G5 | Schedule I (public-charity grants) | 🟡 parser built + fixture-tested + real-data dry-run (11.3% of 990s carry Schedule I; 89.6% of rows carry recipient EIN → direct resolution); runs after back-years + size gate, newest-first |
| G6 | UI v2 | 🟡 ungated commits shipped (recipient links, canonical plumbing incl. redirect + identifier union, shared YearBars, charity variant, /browse thesis blend, facts.ts + census prompt + /data ER section); person pages gated on the people precision gate |
| Suite v2 | `uv run funderdb eval all` — B1–B10 verbatim + E-series semantic + ER floors | ✅ 28 PASS · 0 FAIL · 3 REPORT/SKIP (link jobs SKIP until applied) |

**Benchmark v2:** one command — `uv run funderdb eval all` (subsets: `eval sql`,
`eval semantic`, `eval er`). B-series executes verbatim from
[benchmarks/queries.sql](benchmarks/queries.sql) (append-only record; the
runner prints a paste-ready dated block); assertions live in
[benchmarks/expectations.py](benchmarks/expectations.py). Link-job precision
reports SKIP until a job applies; an uncertified (forced) apply reads as FAIL.

## Phase-1 gates — ALL COMPLETE (2026-07-25)

| Gate | Content | Status |
|---|---|---|
| G0 | Supabase project + schema (10 tables, 7 public views) + smoke-verified upsert/guard SQL | ✅ |
| G1 | IRS EO BMF private foundations | ✅ 134,927 loaded (exact match to verified count), rerun-idempotency proven at scale |
| G2 | Curated federal agencies + programs seed | ✅ 10 agencies + 16 programs; B1 returns all 7 fusion-relevant programs |
| G3 | SEC Form ADV: 23,638 firms (17,050 RIA + 6,588 ERA) + 83k Schedule A/B people + 126k 7B1 funds | ✅ 3,268 classified `vc`, 4,015 `pe`; Lowercarbon fully shaped ($3.13B GAV, 25 funds) |
| G4 | IRS 990-PF XML 2025–26 | ✅ 2.32M grants + 310k officers from 162,793 filings (35,648 index rows not yet zip-packaged by IRS — future re-runs pick up) |
| G5 | SEC Form D 2024q1–2026q1 | ✅ 102,842 offerings (24,151 D/A amendments superseded — reconciles exactly), 119k issuers, 408k related persons |
| G6 | SBIR/STTR awards | ✅ 205,836 awards, 100% agency-linked, 94% seed-program-linked; POC/PI contacts yellow-tier internal-only |
| G7 | Benchmark suite | ✅ 10/10 (results below) |

**Final inventory:** 418,309 orgs (145,589 foundations · 23,638 advisers · 180,174
funds · 68,890 companies · agencies) · 446,222 identifiers · 869,246 people ·
995,135 relationships · **2,633,212 funding events** · 232,910 contact channels
(zero public) · 16 programs · DB 2.9GB (Supabase Pro).

## Benchmark results (2026-07-25)

| # | Benchmark | Result |
|---|---|---|
| B1 | Federal non-dilutive fusion programs | ✅ 7: DOE SBIR/STTR, INFUSE†, FES Milestone, FIRE, ARPA-E, SciDAC (†`funds_lab_not_company`) |
| B2 | SBIR agencies | ✅ 5 seeded agencies; 193,883/205,836 awards program-linked |
| B3 | Named VC targets | ✅ Lowercarbon = vc/ERA/CRD 162946/$3.13B/25 funds. Prelude Ventures: **documented absent from both ADV and Form D** (likely family-office-exempt). Fundable Fusion/Rutherford: absent, too small to file (documented) |
| B4 | Climate/energy VC discovery | ✅ 92 advisers (name-text FTS only — thesis text/embeddings are Phase 2) |
| B5 | Named philanthropy | ✅ 61 Schmidt-family foundations. Stellar Energy Foundation: **public charity** (BMF code 15, EIN 812567715) — outside private-foundation scope; motivates Phase-2 public-charity extension |
| B6 | Energy/science foundations >$10M assets | ✅ 75 |
| B7 | IL science/energy foundations >$10M | ✅ 4 |
| B8 | Grants-paid evidence (fusion) | ✅ Schmidt→MIT PSFC $6M · Schmidt→UW fusion materials $1.2M · Simons→Princeton "Hidden Symmetries and Fusion Energy" $610k · Simons→PPPL $500k; 4,535 energy/science grants from 1,712 foundations |
| B9 | Recent Reg D raisers | ✅ 17,166 offerings in last 12 months; 17,595 VC-fund offerings total |
| B10 | Provenance round-trip | ✅ **0 orphans** across all five fact tables |

## Running

```
uv sync
cp .env.example .env       # add DATABASE_URL (direct connection — see .env.example)
uv run funderdb stage bmf              # download + hash-stage (no DB needed)
uv run funderdb ingest bmf --dry-run   # parse + count locally (no DB needed)
uv run funderdb ingest bmf             # IRS foundations
uv run funderdb ingest seed            # federal agencies + programs
uv run funderdb ingest adv             # SEC ADV firm spine (daily feed)
uv run funderdb ingest adv-schedules   # owners + private funds (monthly zips)
uv run funderdb ingest 990pf           # 990-PF officers + grants (2026+2025)
uv run funderdb ingest formd           # Form D offerings (2024q1->present)
uv run funderdb ingest sbir            # SBIR/STTR awards
uv run funderdb status                 # ledger + row counts
```

## Known limits (Phase 2 targets)

- ADV-side and Form-D-side records of the same fund are separate org rows
  (different ID systems) — the Splink entity-resolution job.
- FTS matches names/titles only ("fusion" also matches bone/protein fusion);
  embeddings + hybrid search are research-plan Stage 2.
- Yet-to-occur Form D first sales carry null `event_date` (filing-date fallback
  is a candidate refinement); a handful of filer-entered absurd amounts survive
  in the Reg D tail.
- Public charities / regranters (BMF codes ≥10, e.g. Stellar Energy Foundation)
  and 990/990-EZ Schedule I grants are not yet loaded.
- Supabase linter flags the `public.*` views as SECURITY DEFINER — **intentional**
  in Phase 1 (owner-rights filtered views, nothing granted to `anon`); flip to
  `security_invoker` when RLS lands in Phase 2.

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

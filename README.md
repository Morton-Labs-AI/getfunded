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
| G6 | UI v2 | 🟡 ungated commits shipped (recipient links, canonical plumbing incl. redirect + identifier union, shared YearBars, charity variant, /browse thesis blend, facts.ts + census prompt + /data ER section); **2026-08-08 merged to UI `main`**: blinded fund-pair labeling UI (dev-only) and Foundation Profiles v2 — profile v2 from existing data (geography, top-recipient rollups, paginated grants, corrected per-row 990 seals, NTEE staleness caveat), `similar_orgs` panel, and the dev-only human-gated website-enrichment flow; **`/person/[id]` shipped** — people chips link from every org type, but the people ER job has not run so every person is per-source and the cluster/redirect paths stay inert until the people precision gate certifies |
| Suite v2 | `uv run funderdb eval all` — B1–B11 verbatim + S-series similarity + E-series semantic + ER floors | ✅ 29 PASS · 0 FAIL · 3 REPORT/SKIP (2026-08-08; link jobs SKIP until applied, B11 vacuous until a confirmed enrichment) |

## Filing-layer gates (status 2026-08-09)

The July 2026 research study asked whether we gather 990 data as richly as
ProPublica displays it. We did not: the pipeline extracted officers and grants
and **zero** financial-statement figures, had no filing entity, and silently
double-counted amended returns. This phase closes that.

| Gate | Content | Status |
|---|---|---|
| F1 | `internal.filings` spine (0013–0016): `processed_filings` promoted to a real filing entity (DLN, submission, batch, period dates, header, amendment state) + `filing_financials` / `filing_officers` / `filing_contributors` / `filing_application_info` + public views + `mv_org_latest_financials` | ✅ 675,806 990-PF + 1,881,691 990 index rows loaded, DLN on 100%; `ingest 990pf --year 2025` re-run reports 0 new (idempotency preserved across the rename) |
| F2 | Amended-return supersession — **a live correctness bug**: amendments carry a new OBJECT_ID, so both copies' grant rows coexisted | ✅ 31,665 filings superseded (winner = greatest object_id; SUB_DATE is unusable — year-only in 2022+, garbage timestamps in 2021). B13 asserts both invariants at 0: no superseded filing retains event rows, no (ein, return_type, tax_period) group keeps two live filings |
| F3 | Parser: 51 financial columns (Part I/II/III/VI/X/XI/XII/XIII/XV), return header, officer compensation/hours/benefits **incl. corporate trustees** (which never enter `internal.people`), grant addresses/ZIP/country/foundation-status/relationship, Schedule B, Part XV how-to-apply, future commitments as `event_type='grant_commitment'` | ✅ `tests/test_990pf_parse.py` 6/6 incl. the real Topfer member; dry-run coverage histogram across 6 returnVersions (2023v6.0–2025v4.0) shows **zero** zero-coverage columns |
| F4 | Detail backfill over staged zips (`ingest 990pf-detail`; never downloads, never inserts grant rows — back-year grant volume stays behind the G2 disk gate) | ✅ **635,301/635,301 live 990-PFs (100%)** — 444,941 detailed in the final run (first attempt, no retries) · 1.44M officer rows · 258,763 Schedule B contributors · 411,840 Part XV rows · 181,551 `grant_commitment` rows · 7.26M grant rows enriched with address/ZIP/country/status/relationship. **0 XML parse errors, 0 filings missing officers, 0 missing financials.** The 35,648 filings that could not be detailed are exactly the documented IRS zip-packaging backlog (17,469 in 2025 + 18,179 in 2026) — indexed OBJECT_IDs whose XML the IRS has never published in a bulk zip |
| F5 | UI v3: per-FY financial trends (revenue/expenses/assets/liabilities), Part I composition bars, filings-by-year index, `/filing/[objectId]` reconstruction (header, balance sheet, officers, grants, Schedule B, how-to-apply), and a raw-XML escape hatch streaming the original e-file out of the staged zip | ✅ zero-JS server-rendered; yauzl with a `7zz` Deflate64 fallback; verified light + dark |

**Parity (REPORT-only, `eval parity`):** against ProPublica's Nonprofit
Explorer API v2, revenue/expenses/total-assets agree **exactly** on the large
majority of comparable filings. Two findings worth recording:

1. Most non-comparable rows are filings **we hold and ProPublica has not
   published yet** (e.g. EIN 27-5271301: their newest is FY2023, we carry
   FY2024). The bulk-XML pipeline runs *ahead* of them on recent IRS releases.
2. **Every** numeric disagreement is the same artifact: ProPublica reports
   `1` where the return reports `0`. Across an 80-filing sample — 51 exact
   agreements, 6 disagreements — all 6 were `ours=0 theirs=1`, with no
   exceptions and no disagreement of any other shape. Two were checked
   against the source document (EIN 86-1263907 FY2022 revenue,
   88-3973214 FY2022 total assets EOY): both read `0` in the IRS XML
   (`TotalRevAndExpnssAmt`, `TotalAssetsEOYAmt`). We match the filing. This is
   why parity is REPORT-only and never gates.

IRS filings are authoritative; ProPublica is a reference implementation and a
validation layer, never a source of truth.

**Coverage measured over parsed filings:** Schedule B 24% · Part XV
application info 23% actionable (contact / materials / deadlines), with most of
the remainder stating only that the foundation funds preselected organizations
and accepts no unsolicited requests · officers on 100% (avg 3.3/filing, 20,273
corporate-trustee rows).

## F6 — discovery, tiered contacts, and the first public artifact (2026-08-09)

F1–F5 put decision-grade data in the database that nothing could reach: of
145,200 foundations with a parsed 990-PF, **101,773 state they fund only
preselected organizations and 26,864 accept applications** — visible only by
opening one filing at a time. Meanwhile `/browse` screened on the BMF asset
snapshot, which **misses 8,880 foundations that actually distributed ≥$500k**.

| Gate | Content | Status |
|---|---|---|
| G1 | `mv_org_application_posture` + `public.org_application_posture` + SQL contact classifiers (0018) | ✅ partition exact and total: 26,864 open · 101,773 preselected · 16,563 unknown of 145,200 |
| G2 | **Closed a live contact leak**: `public.filing_application_info` (shipped in my own 0016) exposed `email`/`phone` for every Part XV row with none of `contact_channels`' three safety layers | ✅ both columns dropped from the view; the UI's filing page read the same untiered column and now uses the tiered query |
| G3–G4 | Part XV contacts → `contact_channels`, tiered | ✅ **832 role inboxes + 30,547 phones public — the first `publishability='public'` rows in project history**; 6,742 named individuals withheld; 1,404 unparseable not loaded |
| G5–G6 | `hybrid_search` rebuilt at 9 args (`app_postures`, `min_distributions`); `search_documents` filter columns; **`org_types` suite bug fixed** | ✅ one overload, grant intact; an impossible `org_types` now returns 0 rows where it previously returned 30 and passed for the wrong reason |
| G7 | Corpus enrichment: posture sentence + Part XV narrative in `doc_text` | ✅ 116,322 docs re-embedded (25.2M tokens, ~$1.51); all 16 federal programs carry posture |
| G8 | Browse posture/distribution facets, Applying section, tiered contact rendering, recipient-side vetting, analyst filters + fail-closed contact mask | ✅ verified on Topfer, Austin, Chicago, Denver |
| G9 | `funderdb export public` — CC-BY dataset | ✅ **25,571,806 rows across 55 files, 2.2GB**; all 7 boundary assertions pass *before* any byte is written |

**The load-bearing correctness rule.** Posture comes from each org's latest
**parsed** filing, never its latest filing. Using the latter lets the 35,648
indexed-but-never-zip-packaged filings win and mislabels **3,806 open
foundations as "unknown"** (unknown inflates 16,563 → 36,251). F3 gates it.

**`unknown` is not `closed`.** It is an absence of a statement and covers every
grantmaking public charity (Form 990 has no Part XV) — including the E5 fixture
set. Nothing in the UI ever renders the word "closed".

**A classifier correction applied the same day it was found.** The first load
published 834 emails; the audit flagged `jdoe.email@example.com` at the *Woo*
Family Foundation. Root cause: `mail`/`email` name a medium, not a role.
Migration 0019 accepts them only as a whole local part, and re-running the
loader **downgraded 834 → 832**. That is why the upsert scopes its `do update`
to rows the loader owns — `do nothing` would have frozen the mistake forever.

**Known limit found today, not yet fixed:** 47 of 191,663 foundation search
documents carry a NULL `app_posture`. They are stale rows for orgs whose grants
disappeared (traceable to the F2 supersession sweep), which the builder no
longer produces but the upsert never deletes. A prune step in `embed sync` is
the fix.

## F7 — public-charity core-form financials (2026-08-09)

The weakest direction in the product was "a foundation vetting a nonprofit":
1,881,691 Form 990 filings carried Schedule I grants but **no financials**, so
charity profiles showed em-dashes where revenue and expenses belong and the
program-vs-administrative expense split existed nowhere.

| Gate | Content | Status |
|---|---|---|
| F7a | Migration 0021: 990 core-form columns on `filing_financials` (Part IX functional split, program-service revenue, headcount) + `related_org_compensation` on `filing_officers` | ✅ |
| F7b | `ingest 990-detail` — Part I/VII/VIII/IX/X extraction, newest-first, resumable | 🟡 **825,755 filings + 8,983,516 officer rows** for 2024–26 (first attempt, no retries); 2021–23 in progress |
| F7c | Charity vetting surface + adaptive expense split + corrected honesty copy | ✅ Mount Sinai renders $4.65B revenue / $4.54B expenses at 91% program services |

**Why it was cheap downstream.** The 990's Part I summary maps one-to-one onto
`filing_financials` columns that were return-type-agnostic from the start
(`total_revenue`, `total_expenses`, `total_assets_eoy`, `net_assets_eoy`…), so
`mv_org_latest_financials`, the browse distributions screen, the FY trend
charts and the CC-BY export all lit up for charities **with no downstream
change**. Only genuinely 990-specific concepts needed new columns.

**The tripwire fired as designed.** F7's second clause asserted charity
financials did *not* exist, precisely so that landing them would break the
check and force the "what this profile can't tell you yet" copy to be updated
instead of quietly going stale. It broke; the copy and the stale
`KNOWN_LIMITS` entry were corrected, and the clause is now a coverage floor so
the next extension still gets caught.

**Export determinism defect found by testing it properly.** `GzipFile` writes
the source filename into the gzip header, so a file's recorded sha256 depended
on what it was *called*, not only what it contained — a rename would have
silently invalidated a published hash. Fixed with `filename=""`; verified in
the strong form (identical content under different filenames now yields the
identical digest). **The published export needs one clean re-run**, since the
fix changes every hash once.

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
995,135 relationships · **14,563,073 funding events** · 232,910 contact channels
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
uv run funderdb ingest filings         # filing spine from index CSVs (no zips)
                                       #   + amended-return supersession sweep
uv run funderdb ingest 990pf-detail    # 990-PF financials/officers/Sched B/
                                       #   how-to-apply from ALREADY-STAGED zips
uv run funderdb ingest 990pf-detail --dry-run --limit 2000
                                       #   per-returnVersion field-coverage
                                       #   histogram — the schema-drift detector
uv run funderdb contacts sync-part-xv --dry-run   # classify, count, write nothing
uv run funderdb contacts sync-part-xv   # Part XV contacts -> contact_channels, tiered
uv run funderdb contacts audit          # publication invariants (every count must be 0)
uv run funderdb export public --verify-only      # boundary assertions, no files
uv run funderdb export public           # CC-BY dataset export
uv run funderdb eval parity             # ProPublica API spot-check (REPORT-only)
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
- Financial-statement extraction is **990-PF only**. Public-charity 990
  core-form financials (Part I/VIII/IX/X) are a later phase — charity profiles
  show a BMF snapshot and a filings index, and the UI lights up automatically
  when those land (its gates are data-presence, not org-type).
- 990-EZ, 990-T, 990-N, Pub. 78, auto-revocations, and determination letters
  are not ingested. Highest-paid-employee and contractor compensation tables
  (which use different element names from the officer group) are parsed but
  not stored.
- No pixel-faithful filing render: `/filing/[objectId]` is a structured
  reconstruction from parsed fields plus the original XML, not the IRS MeF
  XSL stylesheet output.
- Supabase linter flags the `public.*` views as SECURITY DEFINER — **intentional**
  in Phase 1 (owner-rights filtered views, nothing granted to `anon`); flip to
  `security_invoker` when RLS lands in Phase 2.

## Operational notes

- **Connection**: use the direct host `db.poznaikbjcgnthfmqueo.supabase.co` (IPv6)
  for bulk loads. The session pooler intermittently kills large COPY streams
  with `SSL error: bad record mac` — reconfirmed 2026-08-09, when the
  990-PF detail pass died mid-COPY on the pooler and ran clean on the direct
  host. `ingest 990pf-detail` is chunk-committed and re-entrant, so a killed
  run resumes from `details_parsed_at` at no cost; wrap long backfills in a
  bounded retry loop rather than babysitting them.
- **Filer-entered numbers need headroom**: a Schedule B `ContributorNum` of
  `20250001` overflowed `smallint` on first real-data contact (migration 0017
  widened it; the parser also clamps out-of-range values to NULL). Assume any
  filer-controlled numeric can be absurd.
- **Size policy**: `raw_source` JSONB is stored only on low-volume rows (seed,
  future ADV firms); BMF foundations and all funding_events carry locator +
  hashed staged file instead (measured 2026-07-25: raw_source on 135k BMF rows
  cost ~150MB of a 500MB free-tier budget).

## Provenance contract

Every fact traces to: dataset name → source URL → sha256-hashed immutable file
→ license code → ingestion-ledger run. Curated seeds are CC-BY (our original
compilation); government filings are U.S. public domain. Seed-file award
figures and URLs are curated estimates pending founder review.

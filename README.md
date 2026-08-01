# Greenbook — the Open Funder Database dashboard

*"Every dollar, on the record."* An AI-native, local-first interface over the
[Open Funder Database](../open-funder-db): 418,309 organizations, 869,246
people, 2,633,212 funding events — every fact traceable to a sha256-hashed
public filing. The chat **is** the app: natural language → live SQL → evidence,
with the query shown, timed, and every org name one click from its profile and
every number one click from its source file.

## Run it

```bash
npm install
cp .env.example .env.local   # fill DATABASE_URL + ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3010
```

Sanity checks: `npm run db:ping` (connectivity + read-only proof) ·
`npm run guard:test` (SQL-guard unit suite).

## What's inside

| Route | Purpose |
|---|---|
| `/` | **Ask** — census-counter hero + the analyst (SSE chat, `claude-opus-5`, tool-use over Postgres; system prompt is census-driven from the mv_* views, frozen per process for cache stability) |
| `/browse` | Faceted discovery + the ✦ natural-language filter bar (AI sets the same removable chips you could set by hand) — including the **✦ thesis** semantic blend (RRF over giving-behavior docs; rank-ordered top set, offset-paged) for foundations/advisers/companies |
| `/org/[id]` | Type-adaptive profiles (foundation / VC / fund / agency / company / **charity**) with the Provenance Seal on every fact; resolved grant recipients link to their org pages; canonical-merged records redirect to their survivor with a "N merged records" chip (inert until an ER apply runs) |
| `/person/[id]` | canonical person cluster pages: affiliations with role labels, merged-source provenance; per-source rows redirect to their survivor |
| `/programs`, `/programs/[id]` | The 16 curated federal programs; INFUSE/GAIN carry the "funds a national lab on your behalf" nuance |
| `/data` | The trust page: source inventory, coverage, known limits (single-sourced from `lib/content/facts.ts`), the provenance contract, and the live **Entity resolution** panel (tiers, link jobs, label counts with Wilson bounds) |
| ⌘K | Dual-mode palette: entity search → no match? → ask the analyst instead |

## Safety model (model-generated SQL)

1. Statement-head allowlist (`select`/`with`/`explain`) + single-statement — `lib/ai/sql-guard.ts` (pure, unit-tested)
2. **`funder_ro` role**: SELECT-only grants + role-level `default_transaction_read_only=on` and `statement_timeout=15s` (survives pooler startup-param stripping — verified by write probe)
3. Explicit `READ ONLY` transaction per query (kills data-modifying CTEs)
4. LIMIT-wrap at 500 rows; `contact_channels.value` masked server-side, always

## Design system — GREENBOOK

Dark **"Vault"** (flagship) / light **"Ledger"**. Ledger Green accent; the
**trichotomy** (equity violet · grant gold · federal blue) is the product
taxonomy as a color system — chart fills validated with the dataviz palette
validator on both surfaces. Newsreader (editorial) · Inter (product) ·
JetBrains Mono (machine). Signature moments: the census-counter odometer +
sha256 settle, Show-the-Work SQL blocks with live timers, the chain-of-custody
Provenance Seal, Money Register amounts, trichotomy badges, ledger skeletons.
Tabular numerals everywhere; missing data is an em dash, never "$0";
`prefers-reduced-motion` kills all animation.

## Data dependency

Reads the Supabase project `poznaikbjcgnthfmqueo` (schema `internal` +
`mv_*` materialized views from migration `0007_dashboard_stats.sql` in the
data repo). After any new ingest there, run
`select internal.refresh_dashboard_stats();` and the dashboard's numbers
follow (Next cache revalidates hourly).

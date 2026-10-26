# Funder search quality: the October 2026 review

What was wrong with funder search on getfunded.ai on 2026-10-26, what changed,
and what is left. The numbers come from the search eval suite
(`apps/web/evals/search`; reports in `apps/web/evals/search/reports/`).

## Checklist

### P0: unblock and measure
- [x] Describe-the-work search no longer times out (the HNSW walk takes no filter) — PR 26
- [x] Postgres errors are recognized in production builds (minified class names) — PR 26
- [x] A slow meaning-based search answers with keywords and a notice, never the error page — PR 26
- [x] No Voyage call or query is started by Cache Components prerenders — PR 26
- [x] Eval suite: industries, robustness, navigational, 100-profile personalization, facts from grant records
- [x] Baseline scorecards: production and the crash-fix preview

### P1: relevance
- [x] Corpus 0040 giving profiles (where each funder gives, what it funds) and 0041 state index — applied; **fill with `funderdb refresh-views`**
- [x] Web 0018 grants for the app and the analyst — applied
- [x] Short topics ("literacy", "food bank") search funders' giving, not organization names; funder names still go to a name lookup, with "Funders named …" for short words
- [x] Topic results are grantmakers (companies only when asked)
- [x] Places in the words ("in Ohio", "Boise", "in OR") rank funders that give there
- [x] Retrieval legs: meaning, keywords, in-state; ranking weights in `rank.ts`
- [x] "Gives in" and "Funds this cause" filters (once the giving profiles hold data); "State" and "Focus area" relabelled "Based in" and "Funder's own category"
- [x] "Why this funder" evidence on every topic result
- [x] Navigational names: distinctive-word lookup (10 s → 0.3 s), larger giver first among same-name funders

### P2: personalization and onboarding
- [x] Searcher context from URL (`for_state`, `for_cause`, `for_budget`, `for_city`), the words, or the workspace profile
- [x] "Tune results for your organization" panel; "Ignore my profile" in the app
- [x] Onboarding and Settings: cause areas, city, reach, funding needs, typical ask; blank fields filled from the EIN's IRS record
- [x] AI filter: places become "gives in", fields become "funds this cause"; "near us" reads the profile

### P3: speed, analyst, docs
- [x] Analyst: giving profiles described once filled; a "who funds X in a state" recipe that does not scan 18M grants
- [x] Weekly search eval workflow
- [x] `evals/search/README.md`, `IMPROVE.md`, `apps/web/AGENTS.md` section 6
- [ ] Golden labels: seeded in this session (see `evals/search/labels/golden/`); grow them each review
- [ ] Signal alerts: the profile's state is matched as a substring ("CA" in "America") and sector keywords as substrings ("organ" in "organizing") in `getfunded.sync_signal_notifications` (web 0016). Fix with a new migration that matches whole words.

## After the giving profiles are filled

Run `uv run funderdb refresh-views` in `open-nonprofit-platform/corpus` once,
then re-run the eval suite on the deployed site. Ranking switches from each
funder's top recipient states (its search summary) to exact grant counts by
state and recipient cause, and the two filters turn on, with no redeploy.

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
- [x] Golden labels: 240 judged results, the top 10 of the 24 industry sentence searches (`evals/search/labels/golden/`); `judge.mjs score` reports P@10, strong@10 and nDCG@10
- [ ] Grow the golden labels each review: `judge.mjs packets` lists the unjudged top-10 results of a run
- [ ] Signal alerts: the profile's state is matched as a substring ("CA" in "America") and sector keywords as substrings ("organ" in "organizing") in `getfunded.sync_signal_notifications` (web 0016). Fix with a new migration that matches whole words.

### Next: found in this review, not done
- [ ] Name search p95 under 1 s (1.9 s on the final preview: a cold trigram scan on a common word)
- [ ] Greenbook (`apps/greenbook/lib/queries/browse.ts`, `lib/ai/tools.ts`) and the commons MCP (`open-nonprofit-platform/services/commons-mcp/lib/search/sql.ts`) still call `internal.hybrid_search` with filters inside, the exact-scan path that timed out here
- [ ] 9,922 private foundations report giving in their latest 990-PF ($6.8B a year together; 2,806 give $50k or more) but have no search summary, because none of their grants are itemized in the corpus; topic search cannot find them
- [ ] Tuned results are fully local: two profiles in different states share none of their top 20 (twin Jaccard 0.00). Decide how many national funders a tuned first page should keep (the geo weights in `rank.ts`)
- [ ] Write full state names into the search summaries ("Ohio" as well as "OH"), so the meaning leg connects a written-out state to a funder's geography
- [x] Funders whose grants all went to one or two organizations (often a supporting fund for their own affiliate) filled 12% of the judged top-10 slots, and none of the 28 listing a single grantee was a strong lead. They now rank lower and say so (`fewGrantees` in `rank.ts`): topic match 0.82 → 0.89, judged strong@10 0.55 → 0.63
- [x] Personalization guards: the shares with a profile are guarded now (`geo_with_profile` and `cause_with_profile`, at least 0.7 like the topical geo and topic guards), and the lifts are reported only. The lifts fell with the change above (cause 0.17 → 0.06, geo 0.78 → 0.66) because results without a profile improved, while the shares with a profile rose or held (cause 0.81 → 0.84, geo 1.00)
- [ ] On mission queries the profile lowers the cause share a little: 89% without it, 83% with it (82% and 80% before the grantee change). Probably the state boost trading national funders of the cause for local ones (the in-state share goes from 16% to 100%). Look again once the giving profiles are filled and ranking reads exact cause counts
- [ ] An exact count of distinct grantees over five years in the giving profile, to replace reading the summary's grantee list

## After the giving profiles are filled

Run `uv run funderdb refresh-views` in `open-nonprofit-platform/corpus` once,
then re-run the eval suite on the deployed site. Ranking switches from each
funder's top recipient states (its search summary) to exact grant counts by
state and recipient cause, and the two filters turn on, with no redeploy.

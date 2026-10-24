# Classification ledger and bounded candidate review — October 21, 2026

The private ledger now represents all **2,309,073 immutable inventory records**, including explicit unknowns. This is registry classification, not completed vetting. The tracker shows classification, acquisition, source audit, bounded interpretation, qualification, human review, application and publication separately. Existing identity-gate defaults remain unchanged.

## Population and provenance

The ordered inventory SHA-256 remains `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`. The ledger checked the complete inventory count and hash and retains native-page and inventory-line hashes, registry dataset, locator and licensing, dated tax observations and dated acquisition states. It reads existing campaign databases with SQLite read-only connections; its own append-only review records live in a new local database. Build checkpoints and a process lock permit bounded resumption.

There are 1,658,120 explicit subsection03 observations and **650,953 unknown tax classifications**. These observations do not establish current exempt standing. Recorded registry types include 1,870,317 public charities, 166,036 private foundations and 272,720 other entities. The frozen acquisition snapshot has 243,332 evidence-ready, 85,938 blocked and 1,979,803 needing discovery. Recorded types, assets and acquired pages do not establish grantmaking interest.

## Executed 1,000-organization pilot

A fixed systematic sample spans the entire ordered inventory without a funder or website filter. It has no overlap with the 308-candidate review. Native source labels were read separately from the classifier outputs, with exact hashes. All 1,000 outputs agreed on all six checked fields: recorded organization type, country, EIN, NTEE, registry dataset and explicit tax subsection: **6,000/6,000 native-source field comparisons**. This measures faithful source transformation; **independent semantic funder accuracy is not established**. Labels were not human adjudicated.

The sample contains 818 public charities, 80 private foundations, 65 funds, 28 companies, seven investment advisers and two private-equity entities. Rare government/venture-capital types were not sampled. It has 722 explicit tax observations, 278 tax unknowns, 898 EINs, 635 NTEE codes and 107 previously acquired HTML cases whose identities still require review. There are zero duplicate organizations and 1,000 distinct native registry source pages. New verified domains and qualified funders: zero. This is a classification pilot, not a new website-discovery experiment; the earlier missing-website pilot remains 4/1,000.

## All 308 screening candidates reviewed

All frozen candidates received bounded saved-source readings, exact-span citations, source-scoped role/inquiry findings and private before/after evidence cards. Actual local claim-review steps were recorded once per candidate. Preparation, generated cards and annotation revisions do not count as additional organizations or new source audits.

| Source-scoped disposition | Organizations |
|---|---:|
| Publisher grantmaking evidence | 204 |
| Individual aid | 43 |
| In-kind support | 7 |
| Restricted internal programs | 22 |
| Intermediary roles | 10 |
| Historical grantmaking only | 5 |
| Role not established | 17 |
| Total | 308 |

Of the 204 publisher grantmaking cases, **142** also pass the existing identity gate. Across all roles, 209 have a supported gate and **99 retain identity holds**. A role interpretation is possible for 291/308 (94.48%), including historical evidence; this is interpretability yield, not current qualified-funder yield. No independent semantic accuracy percentage can be reported from these same-agent readings.

Inquiry findings: 94 observed routes, 47 question routes, 40 mixed program notices, 18 restricted, 21 closed/expired and 88 unresolved. Routes were observed in saved sources, not contacted or freshly validated. No whole-site last-update date is inferred from crawl dates, copyright years or a single dated page. Current cycle, standing, recent paid donations and target identity remain distinct claims.

Conflicting program dates, closed calls, invited-only funds, individual scholarships, incoming grants and third-party directories remain explicit. Dissolution/winddown evidence is retained rather than treated as an active program. In-kind commodities and equipment are distinguished from cash grants. Page dates are retained as unreviewed leads unless interpreted in scope; a funding page does not establish every program is open.

Duplicate counts are separate: **308 unique organizations**, zero duplicate organization rows; 1,749 distinct raw source references; 1,736 unique URLs (13 repeated URL references); 1,723 unique text hashes (26 repeated text references). There are 582 distinct organization/source/span reading citations. Thirteen annotation revisions are retained, not counted as 13 additional reviews. These source denominators are not added to organization coverage.

Qualified, human-reviewed, remotely applied and published in this ledger: **0 / 0 / 0 / 0**. No prior research batch was replayed. Reusing saved evidence adds no new acquisition or distinct bulk-source-audit coverage.

## Cost and limits

The full local ledger build took **237.964 seconds**; pilot evaluation took **1.586 seconds**. It reused saved sources, with zero new web requests, zero dedicated pipeline model calls and zero Supabase calls/mutations. This does not mean the agent work was free.

The own-session checkpoint through 16:16:45 UTC records 11,018,027 input tokens, including 10,769,920 cached input (248,107 uncached input), and 75,965 output tokens, including 40,768 reasoning tokens. Cached and reasoning subsets must not be added again. This covers implementation and bounded source review, not later reporting/delivery; it is not a steady-state per-organization cost. Invoice dollars are unavailable. No cost-saving or population-accuracy claim is justified yet.

## Next exact phase

1. Independently adjudicate a frozen stratified set of 100 reviewed candidates, oversampling identity holds, multi-entity publishers, historical/closed calls, intermediary and in-kind cases. Keep these results separate from the 1,000 registry-transformation pilot.
2. Resolve the 99 identity holds, 17 role gaps and 88 inquiry gaps with targeted fresh authoritative evidence, preserving overlapping counts and conflicts. Refresh only the claims that require freshness.
3. Freeze the next operational discovery cohort only after this semantic precision/recall check. Measure new identity-supported domains, current funder/fit/inquiry outcomes and actual invoiced cost per useful result before expanding.
4. Document promotion/hold rules and provenance requirements as a versioned decision table; evaluate cheaper automation against the untouched adjudicated holdout. Do not let self-generated labels establish their own accuracy.

The local pending-application root remains `data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`. New ledger/cards are analysis-only, explicitly awaiting separate application. They contain no executable remote patch: a separately requested application session must read exact current remote state, retain before-images and verify expected state before constructing any writes. Existing candidate before-images and immutable public compilation remain retained.

Private run: `data/research/classification-ledger-2026-10-21/`; exact receipts, frozen samples, source hashes, review records, evidence-card index, cost receipt and handoff live there. Raw pages, detailed labels, contact routes and publisher excerpts remain ignored/private. The localhost tracker preserves another worktree's uncommitted semantic panel through a private runtime overlay; none of that worktree's files were edited or committed. Its displayed counts must not be added to this ledger without an organization-level overlap reconciliation. Legacy screening counters describe their saved screening vintage.

Verified by: executed full hash-checked ledger build, the frozen 1,000-case native-field evaluation, 308 exact-source review/step receipts, Python compilation and one loaded tracker page showing both classification and existing semantic panels. Tests: not run (weekly review policy).

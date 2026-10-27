# Search eval: search-v2-grantees

- Ran: 2026-10-26T22:32:11.567Z (1187 s)
- Target: https://getfunded-1opmdu5xc-morton-labs.vercel.app (vercel); facts from: https://getfunded-1opmdu5xc-morton-labs.vercel.app
- Code: d1bf212 Search ranking: funders whose grants all went to one or two organizations rank lower, and sa; suites: industries, navigational, robustness, personalization
- Requests: 457; errors 0%; degraded (timed out, answered another way) 0%

## Scorecard

| Metric | Value | Target | Baseline | |
|---|---|---|---|---|
| error_rate | 0% | ≤ 0% | 0% | pass |
| degraded_rate | 0% | ≤ 2% | 0% | pass |
| topical.funder_rate_at10 | 100% | ≥ 95% | 100% | pass |
| topical.topic_match_at10 | 89% | ≥ 70% | 82% | pass |
| topical.geo_match_at10 | 100% | ≥ 70% | 100% | pass |
| topical.recency_at10 | 99% | ≥ 80% | 99% | pass |
| topical.coverage | 100% | ≥ 95% | 100% | pass |
| navigational.at3 | 100% | ≥ 90% | 100% | pass |
| latency.server_p95_topic_ms | 1521 ms | ≤ 2500 ms | 1952 ms | pass |
| latency.server_p95_name_ms | 1236 ms | ≤ 1000 ms | 1886 ms | FAIL |
| personalization.geo_lift | 0.66 | ≥ 0.25 | 0.78 | regressed |
| personalization.cause_lift | 0.06 | ≥ 0.15 | 0.17 | FAIL |
| personalization.twin_jaccard_state | 0.00 | ≤ 0.35 | 0.00 | pass |
| personalization.twin_jaccard_cause | 0.13 | ≤ 0.35 | 0.11 | pass |
| personalization.profile_coverage | 100% | ≥ 100% | 100% | pass |
| determinism | 100% | ≥ 100% | 100% | pass |

## Relevance by cause (topic match@10, industry cases)

| Cause | | Topic match@10 |
|---|---|---|
| A | Arts, culture and humanities | 93% |
| B | Education | 100% |
| C | Environment | 90% |
| D | Animal-related | 93% |
| E | Health care | 100% |
| F | Mental health and crisis intervention | 83% |
| G | Diseases and disorders | 77% |
| H | Medical research | 97% |
| I | Crime and legal | 100% |
| J | Employment | 83% |
| K | Food, agriculture and nutrition | 93% |
| L | Housing and shelter | 93% |
| M | Public safety and disaster relief | 93% |
| N | Recreation and sports | 77% |
| O | Youth development | 87% |
| P | Human services | 100% |
| Q | International affairs | 83% |
| R | Civil rights and advocacy | 90% |
| S | Community improvement | 90% |
| T | Philanthropy and nonprofit capacity | 57% |
| U | Science and technology | 90% |
| V | Social science research | 80% |
| W | Public and societal benefit | 90% |
| X | Religion-related | 90% |

## Weakest topical cases

| Case | Query | Ran | Funders@10 | Topic@10 | Geo@10 | Top 3 |
|---|---|---|---|---|---|---|
| industries:T-place | grants for small nonprofits in Montana | semantic | 100% | 30% | 100% | MONTANA POOL SERVICE FOUNDATION (private_foundation, MT); MAX AND BETTY SWANSON FOUNDATION (private_foundation, MT); SPIKA COMMUNITY FOUNDATION (private_foundation, MT) |
| industries:J-place | apprenticeship programs in the skilled trades in Michigan | semantic | 100% | 50% | 100% | THE AMERICANA FOUNDATION 71089 (private_foundation, MI); WOLVERINE POWER SUPPLY COOPERATIVE INC (public_charity, MI); WAYNE-METROPOLITAN COMMUNITY ACTION AGENCY (public_charity, MI) |
| industries:T-sentence | training and technical assistance for small nonprofits | semantic | 100% | 50% |  | SOLANO COUNTY PRIVATE INDUSTRY COUNCIL INC (public_charity, CA); KINDRED FUTURES INC (public_charity, GA); POHLAD FAMILY FOUNDATION (private_foundation, MN) |
| industries:N-short | youth sports | semantic | 90% | 60% |  | GOOD SPORTS INC (public_charity, MA); NEXTGEN AAA FOUNDATION (public_charity, NY); IOWA INTENSITY YOUTH SPORTS INC (public_charity, IA) |
| industries:G-place | autism therapy and family support in Minnesota | semantic | 100% | 60% | 100% | SAUER FAMILY FOUNDATION (private_foundation, MN); OTTO BREMER TRUST (private_foundation, MN); UNIVERSITY OF MINNESOTA FOUNDATION (public_charity, MN) |
| industries:O-place | boys and girls club after-school programs in Mississippi | semantic | 100% | 60% | 100% | CENTURY CLUB CHARITIES INC (public_charity, MS); JUNIOR LEAGUE OF JACKSON MISS INC (public_charity, MS); UNITED WAY OF SOUTH MISSISSIPPI INC (public_charity, MS) |
| industries:V-place | public policy research institute in Virginia | semantic | 100% | 60% | 100% | DONORS TRUST INC (public_charity, VA); PUBLIC INTEREST REGISTRY (public_charity, VA); CHARLES KOCH FOUNDATION (private_foundation, VA) |
| robustness:rob-state-code | youth mental health in OR | semantic | 100% | 60% | 100% | OCF JOSEPH E WESTON PUBLIC FOUNDATION (public_charity, OR); HEATHERINGTON FOUNDATION FOR INNOVATION AND EDUCATION IN HEALT (private_foundation, OR); CAREOREGON INC (public_charity, OR) |
| industries:C-place | climate resilience and clean energy projects in Colorado | semantic | 100% | 70% | 100% | ENERGY OUTREACH COLORADO (public_charity, CO); Coloradans For Progress (public_charity, CO); CONSERVATION COLORADO (public_charity, CO) |
| industries:F-place | addiction recovery and substance abuse treatment in West Vir | semantic | 100% | 70% | 100% | WEST VIRGINIA MEDICAL PROFESSIONAL HEALTH PROGRAM INC (public_charity, WV); UNITED WAY OF CENTRAL WEST VIRGINIA INC (public_charity, WV); WEST VIRGINIA DRUG TESTING LABORATORIES INC (public_charity, WV) |
| industries:N-place | public parks and trails in Utah | semantic | 100% | 70% | 100% | COMMUNITY TRUST OF UTAH (public_charity, UT); PARK CITY COMMUNITY FOUNDATION (public_charity, UT); POLICY PROJECT (public_charity, UT) |
| industries:S-place | downtown revitalization and main street programs in Iowa | semantic | 100% | 70% | 100% | IOWA WEST FOUNDATION (private_foundation, IA); BLACK HAWK COUNTY GAMING ASSOC (public_charity, IA); Greenstate Credit Union (public_charity, IA) |

## Navigational

Named funder in the top 3: 100% of 20.

## Personalization (the same words, with and without the organization's profile)

| Measure | With profile | Without | Lift |
|---|---|---|---|
| Shared query: funders that gave in the org's state | 100% | 51% | 0.48 |
| Shared query: funders of the org's cause | 85% | 66% | 0.19 |
| Mission query: gave in the org's state | 100% | 16% | 0.84 |
| Mission query: funders of the org's cause | 83% | 89% | -0.06 |

- Twins, Jaccard@20 of the top 20 for the same shared query (lower = the profile changed more): state 0.00, cause 0.13, budget 1.00.
- Mean pairwise Jaccard@20 across all profiles on the shared queries: 0.01 (1.00 = everyone saw the same list).
- Typical grant size fits the budget (mission query, with profile): 71%. Profiles with ≥ 10 results: 100%.

## Latency by mode

| Mode | n | Client p50 | Client p95 | Server p50 | Server p95 |
|---|---|---|---|---|---|
| semantic | 437 | 1154 | 1901 | 889 | 1521 |
| name | 19 | 311 | 1432 | 135 | 1246 |
| ein | 1 | 272 | 272 | 42 | 42 |

Client times include the network and, for previews, `vercel curl` start-up; server times come from the response's `timing`.

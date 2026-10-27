# Search eval: search-v2-final

- Ran: 2026-10-26T22:03:06.972Z (751 s)
- Target: https://getfunded-aptszl7xg-morton-labs.vercel.app (vercel); facts from: https://getfunded-aptszl7xg-morton-labs.vercel.app
- Code: 235e06d Search: 'gives in' and 'funds this cause' filter every candidate, before the feature cut; suites: industries, navigational, robustness, personalization
- Requests: 457; errors 0%; degraded (timed out, answered another way) 0%

## Scorecard

| Metric | Value | Target | Baseline | |
|---|---|---|---|---|
| error_rate | 0% | ≤ 0% | n/a | pass |
| degraded_rate | 0% | ≤ 2% | n/a | pass |
| topical.funder_rate_at10 | 100% | ≥ 95% | n/a | pass |
| topical.topic_match_at10 | 82% | ≥ 70% | n/a | pass |
| topical.geo_match_at10 | 100% | ≥ 70% | n/a | pass |
| topical.recency_at10 | 99% | ≥ 80% | n/a | pass |
| topical.coverage | 100% | ≥ 95% | n/a | pass |
| navigational.at3 | 100% | ≥ 90% | n/a | pass |
| latency.server_p95_topic_ms | 1952 ms | ≤ 2500 ms | n/a | pass |
| latency.server_p95_name_ms | 1886 ms | ≤ 1000 ms | n/a | FAIL |
| personalization.geo_lift | 0.78 | ≥ 0.25 | n/a | pass |
| personalization.cause_lift | 0.17 | ≥ 0.15 | n/a | pass |
| personalization.twin_jaccard_state | 0.00 | ≤ 0.35 | n/a | pass |
| personalization.twin_jaccard_cause | 0.11 | ≤ 0.35 | n/a | pass |
| personalization.profile_coverage | 100% | ≥ 100% | n/a | pass |
| determinism | 100% | ≥ 100% | n/a | pass |

## Relevance by cause (topic match@10, industry cases)

| Cause | | Topic match@10 |
|---|---|---|
| A | Arts, culture and humanities | 77% |
| B | Education | 97% |
| C | Environment | 80% |
| D | Animal-related | 87% |
| E | Health care | 90% |
| F | Mental health and crisis intervention | 77% |
| G | Diseases and disorders | 77% |
| H | Medical research | 97% |
| I | Crime and legal | 90% |
| J | Employment | 77% |
| K | Food, agriculture and nutrition | 90% |
| L | Housing and shelter | 80% |
| M | Public safety and disaster relief | 83% |
| N | Recreation and sports | 70% |
| O | Youth development | 70% |
| P | Human services | 100% |
| Q | International affairs | 80% |
| R | Civil rights and advocacy | 90% |
| S | Community improvement | 83% |
| T | Philanthropy and nonprofit capacity | 53% |
| U | Science and technology | 87% |
| V | Social science research | 70% |
| W | Public and societal benefit | 80% |
| X | Religion-related | 83% |

## Weakest topical cases

| Case | Query | Ran | Funders@10 | Topic@10 | Geo@10 | Top 3 |
|---|---|---|---|---|---|---|
| industries:T-place | grants for small nonprofits in Montana | semantic | 100% | 30% | 100% | SPIKA COMMUNITY FOUNDATION (private_foundation, MT); MONTANA POOL SERVICE FOUNDATION (private_foundation, MT); MAX AND BETTY SWANSON FOUNDATION (private_foundation, MT) |
| industries:N-short | youth sports | semantic | 100% | 40% |  | GOOD SPORTS INC (public_charity, MA); 1 PETER 410 INC (public_charity, TX); LOS ANGELES ORGANIZING COMMITTEE FOR THE OLYMPIC AND PARALYMPIC GAM (public_charity, CA) |
| industries:T-sentence | training and technical assistance for small nonprofits | semantic | 100% | 40% |  | SOLANO COUNTY PRIVATE INDUSTRY COUNCIL INC (public_charity, CA); INSTITUTE FOR NONPROFIT PRACTICE INC (public_charity, MA); INSTITUTE FOR TRAINING AND DEVELOPMENT INC (public_charity, MA) |
| industries:V-place | public policy research institute in Virginia | semantic | 100% | 40% | 100% | DONORS TRUST INC (public_charity, VA); PUBLIC INTEREST REGISTRY (public_charity, VA); VIRGINIA TECH FOUNDATION INC (public_charity, VA) |
| industries:J-place | apprenticeship programs in the skilled trades in Michigan | semantic | 100% | 50% | 100% | THE AMERICANA FOUNDATION 71089 (private_foundation, MI); WOLVERINE POWER SUPPLY COOPERATIVE INC (public_charity, MI); ROBERT AND CHRISTINE CHILES FOUNDATION (public_charity, MI) |
| industries:O-place | boys and girls club after-school programs in Mississippi | semantic | 100% | 50% | 100% | CENTURY CLUB CHARITIES INC (public_charity, MS); JUNIOR LEAGUE OF JACKSON MISS INC (public_charity, MS); BULLDOG CLUB (public_charity, MS) |
| robustness:rob-state-name | youth mental health in Oregon | semantic | 100% | 50% | 100% | OCF JOSEPH E WESTON PUBLIC FOUNDATION (public_charity, OR); HEATHERINGTON FOUNDATION FOR INNOVATION AND EDUCATION IN HEALT (private_foundation, OR); CAREOREGON INC (public_charity, OR) |
| robustness:rob-one-word | dogs | semantic | 100% | 50% |  | DOGS ON DUTY (public_charity, MO); PUPPIES & GOLF INC (public_charity, CA); SAN FRANCISCO DOG OWNERS GROUP (public_charity, CA) |
| industries:C-place | climate resilience and clean energy projects in Colorado | semantic | 100% | 60% | 100% | ENERGY OUTREACH COLORADO (public_charity, CO); Protecting Colorados Environment Economy And Energy Independence (public_charity, CO); COLORADANS FOR RESPONSIBLE ENERGY DEVELOPMENT (public_charity, CO) |
| industries:G-place | autism therapy and family support in Minnesota | semantic | 100% | 60% | 100% | SAUER FAMILY FOUNDATION (private_foundation, MN); OTTO BREMER TRUST (private_foundation, MN); UNIVERSITY OF MINNESOTA FOUNDATION (public_charity, MN) |
| industries:L-short | affordable housing | semantic | 100% | 60% |  | RHF HOLDINGS GROUP INC (public_charity, CA); VISTA DEL MONTE AFFORDABLE HOUSING INC (public_charity, CA); MERCY HOUSING WHEATON NFP (public_charity, CO) |
| industries:S-place | downtown revitalization and main street programs in Iowa | semantic | 100% | 60% | 100% | IOWA WEST FOUNDATION (private_foundation, IA); BLACK HAWK COUNTY GAMING ASSOC (public_charity, IA); Greenstate Credit Union (public_charity, IA) |

## Navigational

Named funder in the top 3: 100% of 20.

## Personalization (the same words, with and without the organization's profile)

| Measure | With profile | Without | Lift |
|---|---|---|---|
| Shared query: funders that gave in the org's state | 100% | 31% | 0.68 |
| Shared query: funders of the org's cause | 82% | 45% | 0.37 |
| Mission query: gave in the org's state | 100% | 13% | 0.87 |
| Mission query: funders of the org's cause | 80% | 82% | -0.03 |

- Twins, Jaccard@20 of the top 20 for the same shared query (lower = the profile changed more): state 0.00, cause 0.11, budget 1.00.
- Mean pairwise Jaccard@20 across all profiles on the shared queries: 0.01 (1.00 = everyone saw the same list).
- Typical grant size fits the budget (mission query, with profile): 69%. Profiles with ≥ 10 results: 100%.

## Latency by mode

| Mode | n | Client p50 | Client p95 | Server p50 | Server p95 |
|---|---|---|---|---|---|
| semantic | 437 | 1141 | 2167 | 891 | 1952 |
| name | 19 | 352 | 2076 | 133 | 1909 |
| ein | 1 | 315 | 315 | 32 | 32 |

Client times include the network and, for previews, `vercel curl` start-up; server times come from the response's `timing`.

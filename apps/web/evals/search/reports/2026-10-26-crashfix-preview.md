# Search eval: crashfix-preview

- Ran: 2026-10-26T20:46:45.641Z (1520 s)
- Target: https://getfunded-rmtelhv2z-morton-labs.vercel.app (vercel); facts from: https://getfunded-rmtelhv2z-morton-labs.vercel.app
- Code: 0982fce Eval facts: one pass over the window's live grants; filing id via the public view; suites: industries, navigational, robustness, personalization
- Requests: 457; errors 7%; degraded (timed out, answered another way) 55%

## Scorecard

| Metric | Value | Target | Baseline | |
|---|---|---|---|---|
| error_rate | 7% | ≤ 0% | n/a | FAIL |
| degraded_rate | 55% | ≤ 2% | n/a | FAIL |
| topical.funder_rate_at10 | 47% | ≥ 95% | n/a | FAIL |
| topical.topic_match_at10 | 41% | ≥ 70% | n/a | FAIL |
| topical.geo_match_at10 | 46% | ≥ 70% | n/a | FAIL |
| topical.recency_at10 | 45% | ≥ 80% | n/a | FAIL |
| topical.coverage | 63% | ≥ 95% | n/a | FAIL |
| navigational.at3 | 80% | ≥ 90% | n/a | FAIL |
| latency.server_p95_topic_ms | 20759 ms | ≤ 2500 ms | n/a | FAIL |
| latency.server_p95_name_ms | 12604 ms | ≤ 1000 ms | n/a | FAIL |
| personalization.geo_lift | -0.04 | ≥ 0.25 | n/a | FAIL |
| personalization.cause_lift | -0.08 | ≥ 0.15 | n/a | FAIL |
| personalization.twin_jaccard_state | 1.00 | ≤ 0.35 | n/a | FAIL |
| personalization.twin_jaccard_cause | 0.91 | ≤ 0.35 | n/a | FAIL |
| personalization.profile_coverage | 90% | ≥ 100% | n/a | FAIL |
| determinism | 75% | ≥ 100% | n/a | FAIL |

## Relevance by cause (topic match@10, industry cases)

| Cause | | Topic match@10 |
|---|---|---|
| A | Arts, culture and humanities | 60% |
| B | Education | 63% |
| C | Environment | 57% |
| D | Animal-related | 37% |
| E | Health care | 53% |
| F | Mental health and crisis intervention | 7% |
| G | Diseases and disorders | 53% |
| H | Medical research | 37% |
| I | Crime and legal | 10% |
| J | Employment | 17% |
| K | Food, agriculture and nutrition | 20% |
| L | Housing and shelter | 33% |
| M | Public safety and disaster relief | 30% |
| N | Recreation and sports | 47% |
| O | Youth development | 13% |
| P | Human services | 37% |
| Q | International affairs | 60% |
| R | Civil rights and advocacy | 60% |
| S | Community improvement | 27% |
| T | Philanthropy and nonprofit capacity | 50% |
| U | Science and technology | 37% |
| V | Social science research | 60% |
| W | Public and societal benefit | 43% |
| X | Religion-related | 30% |

## Weakest topical cases

| Case | Query | Ran | Funders@10 | Topic@10 | Geo@10 | Top 3 |
|---|---|---|---|---|---|---|
| industries:B-short | literacy | name | 0% | 0% |  | LITERACY LAB (public_charity, DC); Literacy Lab (public_charity, CA); LITERACY LITERACY LITERACY INC (private_foundation, NY) |
| industries:D-short | animal shelter | name | 0% | 0% |  | ANIMAL SHELTER AIDE (public_charity, OR); ANIMAL SHELTER INC (public_charity, MA); ANIMAL SHELTER HEROS (public_charity, NM) |
| industries:F-sentence | suicide prevention and crisis counseling for teenagers | keyword | 0% | 0% |  |  |
| industries:G-place | autism therapy and family support in Minnesota | keyword | 0% | 0% | 0% |  |
| industries:I-sentence | reentry services for people leaving prison | keyword | 0% | 0% |  |  |
| industries:J-short | job training | name | 0% | 0% |  | JOB TRAINING & EMPLOYMENT CORP (public_charity, MA); JOB TRAINING CENTER OF TEHAMA (public_charity, CA); JOB TRAINING FOR BEAVER COUNTY INC (public_charity, PA) |
| industries:K-place | food pantry and hunger relief in rural Kentucky | keyword | 0% | 0% | 0% |  |
| industries:L-place | home repair for low-income seniors in Ohio | keyword | 0% | 0% | 0% |  |
| industries:M-short | disaster relief | name | 0% | 0% |  | DISASTER RELIEF (public_charity, WA); DISASTER RELIEF CHARITY (public_charity, MI); DISASTER RELIEF HAULERS (public_charity, OH) |
| industries:N-short | youth sports | name | 0% | 0% |  | YOUTH SPORTS (public_charity, CO); YOUTH SPORTS INC (public_charity, VA); YOUTH SPORTS META (public_charity, TX) |
| industries:O-short | youth mentoring | name | 0% | 0% |  | YOUTH MENTORING NETWORK (public_charity, IL); YOUTH MENTORING AND SPORTS (public_charity, CA); YOUTH MENTORING CONNECTION (public_charity, CA) |
| industries:Q-short | international development | name | 0% | 0% |  | INTERNATIONAL DEVELOPMENT UNIT (public_charity, CA); INTERNATIONAL DEVELOPMENT HOUSE (public_charity, IL); INTERNATIONAL DEVELOPMENT ANALYSIS (private_foundation, VA) |

## Navigational

Named funder in the top 3: 80% of 20.
Missed: MacArthur Foundation; Moore Foundation; Knight Foundation; Mott Foundation.

## Personalization (the same words, with and without the organization's profile)

| Measure | With profile | Without | Lift |
|---|---|---|---|
| Shared query: funders that gave in the org's state | 24% | 30% | -0.07 |
| Shared query: funders of the org's cause | 54% | 67% | -0.12 |
| Mission query: gave in the org's state | 13% | 13% | -0.00 |
| Mission query: funders of the org's cause | 72% | 75% | -0.03 |

- Twins, Jaccard@20 of the top 20 for the same shared query (lower = the profile changed more): state 1.00, cause 0.91, budget 0.92.
- Mean pairwise Jaccard@20 across all profiles on the shared queries: 0.67 (1.00 = everyone saw the same list).
- Typical grant size fits the budget (mission query, with profile): 61%. Profiles with ≥ 10 results: 90%.

## Latency by mode

| Mode | n | Client p50 | Client p95 | Server p50 | Server p95 |
|---|---|---|---|---|---|
| name | 37 | 7782 | 12880 | 7597 | 12695 |
| semantic | 155 | 4406 | 9637 | 4226 | 9368 |
| keyword | 233 | 12568 | 22962 | 12326 | 22771 |
| ein | 1 | 539 | 539 | 269 | 269 |

Client times include the network and, for previews, `vercel curl` start-up; server times come from the response's `timing`.

## Failures

- robustness:rob-state-code: 504 That search took too long. Add a filter or try fewer words. (youth mental health in OR)
- robustness:rob-one-word: 504 That search took too long. Add a filter or try fewer words. (dogs)
- personalization:st-0-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-0-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-1-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-1-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-2-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-2-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-2-b:shared:1: 504 That search took too long. Add a filter or try fewer words. (funders for our community programs)
- personalization:st-3-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-3-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-4-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-4-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-5-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-5-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-6-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-7-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-8-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-8-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-9-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:st-9-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-0-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-0-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-1-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-2-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-3-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-3-b:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-7-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:ct-8-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)
- personalization:bt-3-a:shared:0: 504 That search took too long. Add a filter or try fewer words. (general operating support grants)

## Degraded answers

- industries:D-sentence: semantic_timed_out
- industries:D-place: semantic_timed_out
- industries:E-short: semantic_timed_out
- industries:E-sentence: semantic_timed_out
- industries:E-place: semantic_timed_out
- industries:F-sentence: semantic_timed_out
- industries:F-place: semantic_timed_out
- industries:G-short: semantic_timed_out
- industries:G-sentence: semantic_timed_out
- industries:G-place: semantic_timed_out
- industries:H-sentence: semantic_timed_out
- industries:H-place: semantic_timed_out
- industries:I-sentence: semantic_timed_out
- industries:I-place: semantic_timed_out
- industries:J-sentence: semantic_timed_out
- industries:J-place: semantic_timed_out
- industries:K-sentence: semantic_timed_out
- industries:K-place: semantic_timed_out
- industries:L-sentence: semantic_timed_out
- industries:L-place: semantic_timed_out
- industries:M-sentence: semantic_timed_out
- industries:M-place: semantic_timed_out
- industries:N-sentence: semantic_timed_out
- industries:N-place: semantic_timed_out
- industries:O-sentence: semantic_timed_out
- industries:O-place: semantic_timed_out
- industries:P-sentence: semantic_timed_out
- industries:P-place: semantic_timed_out
- industries:Q-sentence: semantic_timed_out
- industries:Q-place: semantic_timed_out

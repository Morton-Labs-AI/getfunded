# Search eval: production-baseline

- Ran: 2026-10-26T20:45:16.301Z (1428 s)
- Target: https://getfunded.ai (fetch); facts from: https://getfunded-rmtelhv2z-morton-labs.vercel.app
- Code: 0982fce Eval facts: one pass over the window's live grants; filing id via the public view; suites: industries, navigational, robustness, personalization
- Requests: 457; errors 91%; degraded (timed out, answered another way) 0%

## Scorecard

| Metric | Value | Target | Baseline | |
|---|---|---|---|---|
| error_rate | 91% | ≤ 0% | n/a | FAIL |
| degraded_rate | 0% | ≤ 2% | n/a | pass |
| topical.funder_rate_at10 | 10% | ≥ 95% | n/a | FAIL |
| topical.topic_match_at10 | 5% | ≥ 70% | n/a | FAIL |
| topical.geo_match_at10 | n/a | ≥ 70% | n/a | no data |
| topical.recency_at10 | 8% | ≥ 80% | n/a | FAIL |
| topical.coverage | 91% | ≥ 95% | n/a | FAIL |
| navigational.at3 | 75% | ≥ 90% | n/a | FAIL |
| latency.server_p95_topic_ms | n/a | ≤ 2500 ms | n/a | no data |
| latency.server_p95_name_ms | n/a | ≤ 1000 ms | n/a | no data |
| personalization.geo_lift | 0.00 | ≥ 0.25 | n/a | FAIL |
| personalization.cause_lift | 0.00 | ≥ 0.15 | n/a | FAIL |
| personalization.twin_jaccard_state | n/a | ≤ 0.35 | n/a | no data |
| personalization.twin_jaccard_cause | n/a | ≤ 0.35 | n/a | no data |
| personalization.profile_coverage | 100% | ≥ 100% | n/a | pass |
| determinism | 88% | ≥ 100% | n/a | FAIL |

## Relevance by cause (topic match@10, industry cases)

| Cause | | Topic match@10 |
|---|---|---|
| A | Arts, culture and humanities | 10% |
| B | Education | 0% |
| C | Environment | 10% |
| D | Animal-related | 0% |
| F | Mental health and crisis intervention | 10% |
| H | Medical research | 10% |
| I | Crime and legal | 20% |
| J | Employment | 0% |
| K | Food, agriculture and nutrition | 40% |
| L | Housing and shelter | 0% |
| M | Public safety and disaster relief | 0% |
| N | Recreation and sports | 0% |
| O | Youth development | 0% |
| P | Human services | 0% |
| Q | International affairs | 0% |
| R | Civil rights and advocacy | 10% |
| S | Community improvement | 10% |
| U | Science and technology | 0% |
| V | Social science research | 0% |
| W | Public and societal benefit | 0% |
| X | Religion-related | 0% |

## Weakest topical cases

| Case | Query | Ran | Funders@10 | Topic@10 | Geo@10 | Top 3 |
|---|---|---|---|---|---|---|
| industries:B-short | literacy | name | 0% | 0% |  | LITERACY LAB (public_charity, DC); Literacy Lab (public_charity, CA); LITERACY LITERACY LITERACY INC (private_foundation, NY) |
| industries:D-short | animal shelter | name | 0% | 0% |  | ANIMAL SHELTER AIDE (public_charity, OR); ANIMAL SHELTER INC (public_charity, MA); ANIMAL SHELTER HEROS (public_charity, NM) |
| industries:J-short | job training | name | 0% | 0% |  | JOB TRAINING & EMPLOYMENT CORP (public_charity, MA); JOB TRAINING CENTER OF TEHAMA (public_charity, CA); JOB TRAINING FOR BEAVER COUNTY INC (public_charity, PA) |
| industries:M-short | disaster relief | name | 0% | 0% |  | DISASTER RELIEF (public_charity, WA); DISASTER RELIEF CHARITY (public_charity, MI); DISASTER RELIEF HAULERS (public_charity, OH) |
| industries:N-short | youth sports | name | 0% | 0% |  | YOUTH SPORTS (public_charity, CO); YOUTH SPORTS INC (public_charity, VA); YOUTH SPORTS META (public_charity, TX) |
| industries:O-short | youth mentoring | name | 0% | 0% |  | YOUTH MENTORING NETWORK (public_charity, IL); YOUTH MENTORING AND SPORTS (public_charity, CA); YOUTH MENTORING CONNECTION (public_charity, CA) |
| industries:Q-short | international development | name | 0% | 0% |  | INTERNATIONAL DEVELOPMENT UNIT (public_charity, CA); INTERNATIONAL DEVELOPMENT HOUSE (public_charity, IL); INTERNATIONAL DEVELOPMENT ANALYSIS (private_foundation, VA) |
| industries:X-short | faith-based ministry | name | 0% | 0% |  |  |
| robustness:rob-caps | HOMELESS SHELTER | name | 0% | 0% |  | HOMELESS SHELTER WORKSHOP INC (public_charity, CA); TLGY HOMELESS SHELTER (public_charity, AZ); AGAPE HOMELESS SHELTER (public_charity, OH) |
| industries:P-short | senior services | name | 10% | 0% |  | SENIOR SERVICES (public_charity, WA); Senior Services Inc (private_foundation, NY); SENIOR SERVICES INC (public_charity, NC) |
| industries:U-short | STEM education | name | 10% | 0% |  | STEM EDUCATION INC (public_charity, CO); STEM EDUCATION FOUNDATION (public_charity, AZ); STEM EDUCATION SUPPORT (public_charity, CA) |
| industries:V-short | policy research | name | 10% | 0% |  | POLICY RESEARCH INC (public_charity, NY); POLICY RESEARCH ASSOCIATES INC (company, New York); POLICY RESEARCH INTERNATIONAL INC (public_charity, NY) |

## Navigational

Named funder in the top 3: 75% of 16.
Missed: MacArthur Foundation; Moore Foundation; Knight Foundation; Mott Foundation.

## Personalization (the same words, with and without the organization's profile)

| Measure | With profile | Without | Lift |
|---|---|---|---|
| Shared query: funders that gave in the org's state | n/a | n/a | n/a |
| Shared query: funders of the org's cause | n/a | n/a | n/a |
| Mission query: gave in the org's state | 30% | 30% | 0.00 |
| Mission query: funders of the org's cause | 100% | 100% | 0.00 |

- Twins, Jaccard@20 of the top 20 for the same shared query (lower = the profile changed more): state n/a, cause n/a, budget n/a.
- Mean pairwise Jaccard@20 across all profiles on the shared queries: n/a (1.00 = everyone saw the same list).
- Typical grant size fits the budget (mission query, with profile): 100%. Profiles with ≥ 10 results: 100%.

## Latency by mode

| Mode | n | Client p50 | Client p95 | Server p50 | Server p95 |
|---|---|---|---|---|---|
| name | 38 | 6543 | 18962 | n/a | n/a |
| ein | 1 | 365 | 365 | n/a | n/a |
| semantic | 2 | 19803 | 20890 | n/a | n/a |

Client times include the network and, for previews, `vercel curl` start-up; server times come from the response's `timing`.

## Failures

- industries:A-sentence: 500 The search could not be completed. Please try again. (community theater programs for youth and families)
- industries:A-place: 500 The search could not be completed. Please try again. (art museum exhibitions and education programs in New Mexico)
- industries:B-sentence: 500 The search could not be completed. Please try again. (after-school reading tutoring for elementary students)
- industries:B-place: 500 The search could not be completed. Please try again. (college scholarships for first-generation students in Georgi)
- industries:C-sentence: 500 The search could not be completed. Please try again. (protecting rivers and watersheds from pollution)
- industries:C-place: 500 The search could not be completed. Please try again. (climate resilience and clean energy projects in Colorado)
- industries:D-sentence: 500 The search could not be completed. Please try again. (spay and neuter programs for stray cats and dogs)
- industries:D-place: 500 The search could not be completed. Please try again. (wildlife rehabilitation center in Florida)
- industries:E-short: 500 The search could not be completed. Please try again. (rural health clinics)
- industries:E-sentence: 500 The search could not be completed. Please try again. (free medical clinic for uninsured adults)
- industries:E-place: 500 The search could not be completed. Please try again. (community health center serving low-income families in Arizo)
- industries:F-sentence: 500 The search could not be completed. Please try again. (suicide prevention and crisis counseling for teenagers)
- industries:F-place: 500 The search could not be completed. Please try again. (addiction recovery and substance abuse treatment in West Vir)
- industries:G-short: 500 The search could not be completed. Please try again. (cancer patient support)
- industries:G-sentence: 500 The search could not be completed. Please try again. (support services for families living with Alzheimer's diseas)
- industries:G-place: 500 The search could not be completed. Please try again. (autism therapy and family support in Minnesota)
- industries:H-sentence: 500 The search could not be completed. Please try again. (research grants for pediatric cancer cures)
- industries:H-place: 500 The search could not be completed. Please try again. (biomedical research on rare diseases in Massachusetts)
- industries:I-sentence: 500 The search could not be completed. Please try again. (reentry services for people leaving prison)
- industries:I-place: 500 The search could not be completed. Please try again. (free legal services for domestic violence survivors in Washi)
- industries:J-sentence: 500 The search could not be completed. Please try again. (workforce development and career training for unemployed adu)
- industries:J-place: 500 The search could not be completed. Please try again. (apprenticeship programs in the skilled trades in Michigan)
- industries:K-sentence: 500 The search could not be completed. Please try again. (fighting childhood hunger with weekend meal programs)
- industries:K-place: 500 The search could not be completed. Please try again. (food pantry and hunger relief in rural Kentucky)
- industries:L-sentence: 500 The search could not be completed. Please try again. (emergency shelter and housing for homeless families)
- industries:L-place: 500 The search could not be completed. Please try again. (home repair for low-income seniors in Ohio)
- industries:M-sentence: 500 The search could not be completed. Please try again. (volunteer fire department equipment and training)
- industries:M-place: 500 The search could not be completed. Please try again. (hurricane recovery and disaster preparedness in Louisiana)
- industries:N-sentence: 500 The search could not be completed. Please try again. (summer camps and outdoor recreation for children)
- industries:N-place: 500 The search could not be completed. Please try again. (public parks and trails in Utah)

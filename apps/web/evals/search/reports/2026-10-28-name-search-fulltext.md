# Search eval: name-search-fulltext

- Ran: 2026-10-28T15:44:46.918Z (35 s)
- Target: https://getfunded-jziw5dajz-morton-labs.vercel.app (vercel); facts from: https://getfunded-jziw5dajz-morton-labs.vercel.app
- Code: 7ef7dfc Match whole words before the last in a name search; route two name shapes; suites: navigational
- Requests: 20; errors 0%; degraded (timed out, answered another way) 0%

## Scorecard

| Metric | Value | Target | Baseline | |
|---|---|---|---|---|
| error_rate | 0% | ≤ 0% | 0% | pass |
| degraded_rate | 0% | ≤ 2% | 0% | pass |
| topical.funder_rate_at10 | n/a | ≥ 95% | 100% | no data |
| topical.topic_match_at10 | n/a | ≥ 70% | 89% | no data |
| topical.geo_match_at10 | n/a | ≥ 70% | 100% | no data |
| topical.recency_at10 | n/a | ≥ 80% | 99% | no data |
| topical.coverage | n/a | ≥ 95% | 100% | no data |
| navigational.at3 | 100% | ≥ 90% | 100% | pass |
| latency.server_p95_topic_ms | n/a | ≤ 2500 ms | 1521 ms | no data |
| latency.server_p95_name_ms | 572 ms | ≤ 1000 ms | 1236 ms | pass |
| personalization.geo_with_profile | n/a | ≥ 70% | 100% | no data |
| personalization.cause_with_profile | n/a | ≥ 70% | 84% | no data |
| personalization.twin_jaccard_state | n/a | ≤ 0.35 | 0.00 | no data |
| personalization.twin_jaccard_cause | n/a | ≤ 0.35 | 0.13 | no data |
| personalization.profile_coverage | n/a | ≥ 100% | 100% | no data |
| determinism | 100% | ≥ 100% | 100% | pass |

## Relevance by cause (topic match@10, industry cases)

| Cause | | Topic match@10 |
|---|---|---|

## Weakest topical cases

| Case | Query | Ran | Funders@10 | Topic@10 | Geo@10 | Top 3 |
|---|---|---|---|---|---|---|

## Navigational

Named funder in the top 3: 100% of 20.

## Latency by mode

| Mode | n | Client p50 | Client p95 | Server p50 | Server p95 |
|---|---|---|---|---|---|
| name | 19 | 984 | 2045 | 215 | 576 |
| ein | 1 | 951 | 951 | 42 | 42 |

Client times include the network and, for previews, `vercel curl` start-up; server times come from the response's `timing`.

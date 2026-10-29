/**
 * How a topic search orders funders. One place, so the eval suite
 * (evals/search, IMPROVE.md) can move a weight and measure what happened.
 *
 * score = relevance                     the retrieval legs, merged by rank
 *       + gives where you work          the searcher's state (words, tuning or profile)
 *       + funds work like yours         the searcher's cause (tuning or profile)
 *       + accepts applications / not    the latest 990-PF's answer
 *       + still giving                  a grant in the last few fiscal years
 *       + gives beyond one organization its grants on file reach more than one or two grantees
 *       + grant size fits the budget    only with exact giving profiles and a budget
 *
 * Relevance is reciprocal-rank fusion (k = 60) of three legs, scaled so a
 * funder first in both the meaning and the keyword leg scores about 1:
 *   meaning   the closest funder summaries to the query embedding (HNSW)
 *   keywords  summaries containing every word of the topic
 *   in-state  summaries of funders based in the searcher's state that mention
 *             the topic's words
 *
 * "Gives where you work" reads the exact count of grants to the state when
 * the corpus 0040 giving profiles are loaded, and otherwise the funder's top
 * recipient states as its search summary lists them ("Grant geography: OH,
 * KY, ..."), first state strongest.
 *
 * "Gives beyond one organization" reads the grantee list in the funder's
 * search summary ("Grantees: A; B; ...", up to 15 names, all years). A funder
 * whose grants all went to one or two organizations is usually a supporting
 * fund for its own affiliate (a station's "Friends of", a fire company's
 * relief fund), not a funder another nonprofit can apply to. When the summary
 * cuts off before the list ends, the count is unknown and nothing is taken off.
 *
 * Nothing here removes a funder. A preselected-only funder ranks lower and is
 * never called closed (governance rule 1).
 */

export type RankWeights = {
  /**
   * How the fit for the searcher (place, cause) meets relevance:
   *   "add"       relevance + fit: a local funder can outrank a closer topical match
   *   "multiply"  relevance x (1 + fit): fit lifts funders that already match the words
   */
  blend: "add" | "multiply";
  /** Weight of the keyword leg against the meaning leg (1). */
  keywordLeg: number;
  /** Weight of the in-state leg. */
  localLeg: number;
  /** Top score for giving in the searcher's state. */
  geo: number;
  /** Extra for being based in the searcher's state. */
  located: number;
  /** Top score for funding the searcher's cause. */
  cause: number;
  /** The latest 990-PF says it accepts applications. */
  open: number;
  /** The latest 990-PF says it gives only to preselected organizations (subtracted). */
  preselected: number;
  /** No grant in the last few fiscal years (subtracted). */
  stale: number;
  /** Every grant on file went to one organization (subtracted; FEW_GRANTEES scales it for two and three). */
  fewGrantees: number;
  /** Typical grant fits the searcher's budget (added) or dwarfs it (subtracted). */
  size: number;
};

/**
 * Measured 2026-10-26 (evals/search, full suite on previews): "add" with these
 * weights beat "multiply" (geo 1, located 0.3, cause 0.6) on topic match
 * (0.811 vs 0.806), geo match (0.966 vs 0.955) and cause lift (0.17 vs 0.14).
 */
export const RANK_WEIGHTS: RankWeights = {
  blend: "add",
  keywordLeg: 0.8,
  localLeg: 1,
  geo: 0.45,
  located: 0.15,
  cause: 0.3,
  open: 0.05,
  preselected: 0.12,
  stale: 0.2,
  fewGrantees: 0.2,
  size: 0.1,
};

/**
 * Share of `fewGrantees` taken off a funder whose summary lists one, two or
 * three grantees. From the judged labels (evals/search/labels/golden, 240
 * top-10 results, 2026-10-26): strong leads were 0 of 28 funders listing one
 * grantee, 1 of 14 listing two, 1 of 6 listing three, against 90 of 119
 * listing the full fifteen and 11 of 24 whose list could not be read.
 *
 * Measured with fewGrantees 0.2 against 0 (full suite on previews, the same
 * 24 judged top 10s): topic match 0.82 to 0.89, judged strong@10 0.55 to
 * 0.63, nDCG@10 0.88 to 0.92. The cause lift fell from 0.17 to 0.06, because
 * the results without a profile got better (their cause share rose from 0.45
 * to 0.66) while those with one rose from 0.82 to 0.85.
 */
export const FEW_GRANTEES = [1, 0.75, 0.3] as const;

/** Grants to the state that earn the full geo score (log scale below it). */
export const GEO_FULL_AT = 20;
/** Share of a funder's recent grants to the cause that earns the full cause score. */
export const CAUSE_FULL_SHARE = 0.2;
/** A funder whose latest grant is older than this many years before the corpus's latest is "not recently giving". */
export const STALE_AFTER_YEARS = 3;

/** Candidates per leg, and how many of the merged list get the full features. */
export const LEG_LIMITS = { meaning: 600, keywords: 300, local: 150, features: 200 } as const;

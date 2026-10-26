/**
 * How a topic search orders funders. One place, so the eval suite
 * (evals/search, IMPROVE.md) can move a weight and measure what happened.
 *
 * score = relevance                     the retrieval legs, merged by rank
 *       + gives where you work          the searcher's state (words, tuning or profile)
 *       + funds work like yours         the searcher's cause (tuning or profile)
 *       + accepts applications / not    the latest 990-PF's answer
 *       + still giving                  a grant in the last few fiscal years
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
  /** Typical grant fits the searcher's budget (added) or dwarfs it (subtracted). */
  size: number;
};

export const RANK_WEIGHTS: RankWeights = {
  blend: "multiply",
  keywordLeg: 0.8,
  localLeg: 1,
  geo: 1,
  located: 0.3,
  cause: 0.6,
  open: 0.05,
  preselected: 0.12,
  stale: 0.2,
  size: 0.1,
};

/** Grants to the state that earn the full geo score (log scale below it). */
export const GEO_FULL_AT = 20;
/** Share of a funder's recent grants to the cause that earns the full cause score. */
export const CAUSE_FULL_SHARE = 0.2;
/** A funder whose latest grant is older than this many years before the corpus's latest is "not recently giving". */
export const STALE_AFTER_YEARS = 3;

/** Candidates per leg, and how many of the merged list get the full features. */
export const LEG_LIMITS = { meaning: 600, keywords: 300, local: 150, features: 200 } as const;

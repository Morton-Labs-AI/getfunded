/**
 * Shapes for "what its returns show": two counts from a foundation's own
 * Form 990-PF returns, shown beside the "Can I apply?" answer.
 *
 *   1. PostureHistory: how the foundation answered the application question
 *      on every parsed, non-superseded Form 990-PF we hold
 *      (internal.mv_org_posture_history, corpus migration 0029).
 *   2. RecipientTurnover: for one fiscal year, how many named grant
 *      recipients were on none of the same foundation's grant lists for the
 *      three fiscal years before (internal.funder_recipient_turnover, filled
 *      by `funderdb derive turnover`).
 *
 * Both are counts from past returns. Neither says the foundation will
 * consider a new request, and nothing here is a score, a tier or a label.
 * No model is involved, so nothing here is labelled AI.
 *
 * Plain types and pure checks, with no server-only import, so the copy
 * module and components on either side of the server / client boundary can
 * use them. Everything is serializable, like lib/queries/corpus/types.ts.
 */
import type { Provenance } from "./types";

/** The three application answers, as the page names them (PostureValue in components/data/posture). */
export type HistoryPosture = "open" | "preselected" | "unknown";
/** An answer the return actually states. */
export type StatedPosture = "open" | "preselected";

export type PostureHistory = {
  /** Parsed, non-superseded Form 990-PF returns on record. */
  nReturns: number;
  nOpen: number;
  nPreselected: number;
  /** Returns with no Part XV statement. Silent is not an answer either way. */
  nNotStated: number;
  firstFy: number | null;
  lastFy: number | null;
  /** The newest return: the one the posture badge is read from. */
  latestPosture: HistoryPosture;
  latestFy: number | null;
  latestObjectId: string;
  /** Seal for the newest return. Null when the filing is not publishable; the line is then not shown. */
  provenance: Provenance | null;
  /**
   * The most recent return whose STATED answer differs from the newest
   * answer. When the newest return is silent this is the last stated answer.
   * Null when there is none.
   */
  other: {
    posture: StatedPosture;
    fy: number | null;
    objectId: string;
    provenance: Provenance | null;
  } | null;
  /**
   * Words in the newest return's Part XV text that read like a limit on
   * applications, exactly as filed (lower case). Only set when the newest
   * answer is "open". A pointer to the text, not a judgement.
   */
  restrictivePhrase: string | null;
};

export type RecipientTurnover = {
  fy: number;
  /** Distinct named recipients on the fiscal year's grant list. Always 1 or more. */
  nRecipients: number;
  /** Of those, how many are on none of the three earlier lists. */
  nNew: number;
  /** Counted as already listed only because of the similar-name rule. */
  nSeenSimilar: number;
  windowFirstFy: number;
  windowLastFy: number;
  nRows: number;
  /** Grant rows in the fiscal year with placeholder text instead of a name. */
  nUnnamedRows: number;
  /** Placeholder rows in the three earlier years. Above 0, the count is not shown. */
  windowUnnamedRows: number;
  /** The filing the count is sealed from. */
  objectId: string | null;
  ruleVersion: string;
  /** Null when the filing is missing, superseded since the count, or not publishable. */
  provenance: Provenance | null;
};

export type ApplicationHistory = {
  history: PostureHistory | null;
  /** Up to three fiscal years, newest first. */
  turnover: RecipientTurnover[];
};

/** How one foundation's answers read across its returns. `none` means: show no line. */
export type PostureHistoryCase =
  | { kind: "none" }
  /** Two or more returns, every one states the same answer. */
  | { kind: "same"; n: number }
  /**
   * The newest return states an answer and not every return agrees.
   * `k` returns give the newest answer, `nOther` give the other stated
   * answer (0 when none does) and `nSilent` state nothing.
   */
  | { kind: "mixed"; k: number; n: number; nOther: number; nSilent: number }
  /**
   * The newest return is silent and an earlier one states an answer.
   * `nOther` returns give the most recent stated answer; `nThird` give the
   * remaining stated answer (0 when none does).
   */
  | { kind: "latest-silent"; n: number; nOther: number; nThird: number; third: StatedPosture | null };

function countOf(h: PostureHistory, p: HistoryPosture): number {
  return p === "open" ? h.nOpen : p === "preselected" ? h.nPreselected : h.nNotStated;
}

/**
 * Which sentence fits this history. Pure, so the page and any export agree.
 *
 * Shows nothing for one return ("all 1 returns" says nothing), for a
 * foundation that is silent on every return (there is no answer to count),
 * and for a row whose counts do not add up.
 */
export function postureHistoryCase(h: PostureHistory | null | undefined): PostureHistoryCase {
  if (!h) return { kind: "none" };
  const n = h.nReturns;
  if (n < 2) return { kind: "none" };
  if (h.nOpen + h.nPreselected + h.nNotStated !== n) return { kind: "none" };
  if (h.nNotStated === n) return { kind: "none" };

  if (h.latestPosture === "unknown") {
    if (!h.other) return { kind: "none" };
    const third: StatedPosture = h.other.posture === "open" ? "preselected" : "open";
    const nThird = countOf(h, third);
    return { kind: "latest-silent", n, nOther: countOf(h, h.other.posture), nThird, third: nThird > 0 ? third : null };
  }

  const k = countOf(h, h.latestPosture);
  if (k < 1) return { kind: "none" };
  if (k === n) return { kind: "same", n };
  const otherPosture: StatedPosture = h.latestPosture === "open" ? "preselected" : "open";
  return { kind: "mixed", k, n, nOther: countOf(h, otherPosture), nSilent: h.nNotStated };
}

/**
 * True when the page may print the history line next to the posture badge:
 * the history row and the badge must be read from the SAME return and give
 * the same answer (the two views are refreshed together, but a page can load
 * between a migration and the first refresh), and the return must have a seal.
 */
export function historyMatchesBadge(
  h: PostureHistory | null | undefined,
  badgePosture: HistoryPosture,
  badgeObjectId: string | null | undefined,
): h is PostureHistory {
  return Boolean(h && badgeObjectId && h.latestObjectId === badgeObjectId && h.latestPosture === badgePosture && h.provenance);
}

/**
 * The turnover row the page may print: the newest fiscal year, and only when
 * the count can be trusted and sealed. Otherwise null, and the page prints
 * nothing (it never falls back to an older year or to a zero).
 *
 * Not shown when an earlier list had placeholder rows ("see attached"):
 * recipients can then look new only because the earlier names are missing.
 */
export function showableTurnover(rows: RecipientTurnover[] | null | undefined): RecipientTurnover | null {
  const t = rows?.[0];
  if (!t) return null;
  if (!t.provenance) return null;
  if (t.windowUnnamedRows > 0) return null;
  if (t.nRecipients < 1 || t.nNew < 0 || t.nNew > t.nRecipients) return null;
  return t;
}

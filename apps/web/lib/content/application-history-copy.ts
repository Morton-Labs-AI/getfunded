/**
 * Copy for "what its returns show": two counts from a foundation's own
 * Form 990-PF returns, shown under the "Can I apply?" answer. Kept in its own
 * file so it can be folded into copy.ts in one step. The rules of copy.ts
 * hold here too:
 *  - plain language for a nonprofit audience;
 *  - a number that drifts (counts, fiscal years) is passed in, never written
 *    into a string;
 *  - the word that copy.ts bans for an application posture never appears,
 *    and a missing value is never shown as a zero;
 *  - nothing here says a foundation is interested in anyone, will consider a
 *    request, or is more or less probable to fund. There is no score. Every
 *    sentence states what public returns say and nothing more;
 *  - every string says "Form 990-PF returns", because the count covers that
 *    form only and can differ from "Returns on record" in the basics panel;
 *  - no model is involved, so nothing here is labelled AI.
 *
 * The posture labels themselves stay in components/data/posture.tsx
 * (POSTURE_LABELS); callers pass the label in.
 */
import { formatNumber } from "@/lib/format";
import type { HistoryPosture, PostureHistory, PostureHistoryCase } from "@/lib/queries/corpus/application-history-types";

export const APPLICATION_HISTORY_EYEBROW = "What its returns show";

/** " (FY2019 to FY2023)", " (FY2023)" or "" when the years are not on record. */
function fiscalYears(firstFy: number | null, lastFy: number | null): string {
  if (firstFy === null || lastFy === null) return "";
  return firstFy === lastFy ? ` (FY${firstFy})` : ` (FY${firstFy} to FY${lastFy})`;
}

/* ------------------------------------------------- the application answer */

/** Two or more returns, every one states the answer the badge shows. */
export const POSTURE_HISTORY_SAME = (n: number, firstFy: number | null, lastFy: number | null) =>
  `Stated the same way on all ${formatNumber(n)} Form 990-PF returns on record${fiscalYears(firstFy, lastFy)}.`;

/** The answer the badge shows is on `k` of `n` returns. Follow it with the sentences below. */
export const POSTURE_HISTORY_K_OF_N = (k: number, n: number, firstFy: number | null, lastFy: number | null) =>
  `Stated this way on ${formatNumber(k)} of ${formatNumber(n)} Form 990-PF returns on record${fiscalYears(firstFy, lastFy)}.`;

/** The newest return is silent. Follow it with the earlier answer. */
export const POSTURE_HISTORY_LATEST_SILENT = (latestFy: number | null) =>
  latestFy !== null
    ? `The latest Form 990-PF return (FY${latestFy}) does not state an application policy.`
    : "The latest Form 990-PF return does not state an application policy.";

/**
 * The text around the other stated answer, in two parts so the answer itself
 * (a posture label) can sit between them and carry the earlier return's seal:
 *   before + label + after
 *   "The FY2021 return said: " + "Accepts applications" + "."
 *   "3 returns said: " + "Accepts applications" + ". The most recent of them is the FY2021 return."
 */
export const POSTURE_HISTORY_OTHER_ANSWER = (nOther: number, fy: number | null): { before: string; after: string } => {
  if (nOther <= 1) {
    return { before: fy !== null ? `The FY${fy} return said: ` : "One return said: ", after: "." };
  }
  return {
    before: `${formatNumber(nOther)} returns said: `,
    after: fy !== null ? `. The most recent of them is the FY${fy} return.` : ".",
  };
};

/** A count-only sentence for a stated answer, used when there is no single return to cite. */
export const POSTURE_HISTORY_ALSO_SAID = (m: number, label: string) =>
  m === 1 ? `1 return said: ${label}.` : `${formatNumber(m)} returns said: ${label}.`;

/** Returns with no statement. Silent is not an answer either way. */
export const POSTURE_HISTORY_SILENT_COUNT = (s: number) =>
  s === 1 ? "1 return does not state a policy." : `${formatNumber(s)} returns do not state a policy.`;

/*
 * There is no line for "words that read like a limit" any more. The database
 * still stores the matched words (mv_org_posture_history.restrictive_phrase)
 * for analysis, but the page does not quote them: of 30 stored phrases read
 * on 2026-10-08, 9 did not mean a limit on applications at all ("no
 * applications are required", "does not accept requests of funds for
 * individuals", "pre-selected fields") and 2 more overstated one. A quote
 * that can point the wrong way is worse than no quote. The full instructions
 * are on the page, as filed.
 */

/** Under the answer lines. Says what was counted. */
export const APPLICATION_HISTORY_NOTE =
  "These lines count this foundation's own Form 990-PF returns that the IRS has published as data. " +
  "An amended return replaces its original. They describe past returns only.";

/* -------------------------------------------------- recipients, year on year */

export const TURNOVER_LISTED = (fy: number, nRecipients: number) =>
  `On its FY${fy} Form 990-PF return this foundation listed grants to ${formatNumber(nRecipients)} named ` +
  `${nRecipients === 1 ? "recipient" : "recipients"}.`;

/** How many of them are not on the three earlier lists: "k of n", in plain words at both ends. */
export const TURNOVER_NOT_ON_EARLIER_LISTS = (nNew: number, nRecipients: number, windowFirstFy: number, windowLastFy: number) => {
  const lists = `its FY${windowFirstFy} to FY${windowLastFy} grant lists`;
  if (nRecipients === 1) return nNew === 0 ? `That recipient is also on ${lists}.` : `That recipient is not on ${lists}.`;
  if (nNew === 0) return `All ${formatNumber(nRecipients)} are also on ${lists}.`;
  if (nNew === nRecipients) return `None of the ${formatNumber(nRecipients)} is on ${lists}.`;
  return `${formatNumber(nNew)} of ${formatNumber(nRecipients)} ${nNew === 1 ? "is" : "are"} not on ${lists}.`;
};

/**
 * Always shown with the recipient line. First what the number is not, then
 * how it was counted, then who is left out, then where it can be wrong, in
 * both directions. It describes rule turnover-v2 of `funderdb derive
 * turnover`; the reader shows no row of another rule version.
 */
export const TURNOVER_NOTE = (nUnnamedRows: number) => {
  const unnamed =
    nUnnamedRows > 0
      ? ` ${formatNumber(nUnnamedRows)} grant ${nUnnamedRows === 1 ? "row on this return names" : "rows on this return name"} ` +
        "no recipient we can compare (for example \"see attached\", or a name shorter than four characters) " +
        `and ${nUnnamedRows === 1 ? "is" : "are"} not counted.`
      : "";
  return (
    "This is a count from past returns. It does not say the foundation will consider a new request. " +
    "How it is counted: names are compared as written on the returns, without \"The\" at the start, without endings such as \"Inc\" or \"LLC\", " +
    "and without spaces and punctuation. " +
    "A recipient also counts as already listed when our records link it to the same organization as an earlier recipient, " +
    "or when its name is almost the same as an earlier name (a trigram similarity of 0.8 or more, where 1 means identical). " +
    "The state on the grant row is not compared. " +
    "Grants that the foundation marked as paid to an individual, such as a scholarship, are left out of both numbers, " +
    "and no count is shown when most of its grants are marked that way. " +
    "A person whom the foundation did not mark as an individual is still counted as a recipient. " +
    "A recipient can still look new when its name is written very differently from year to year, " +
    "and two different recipients with almost the same name can be counted as one." +
    unnamed
  );
};

/* ---------------------------------------------------- fit analysis evidence */

/** Chip label for the evidence item below. */
export const APPLICATION_HISTORY_EVIDENCE_LABEL = (latestFy: number | null) =>
  latestFy !== null ? `IRS 990-PF · returns on record to FY${latestFy}` : "IRS 990-PF · returns on record";

/**
 * The same facts the page prints under "What its returns show", as one plain
 * paragraph for the fit analysis to cite: how the foundation answered the
 * application question across its Form 990-PF returns. It is built from the
 * sentences above, so the page and the evidence cannot say different things.
 *
 * It carries the counts of returns only. The recipient counts are left out on
 * purpose: they say nothing about a new request, and a model must not read
 * them as interest. `labels` are the posture labels (POSTURE_LABELS).
 */
export function applicationHistoryEvidenceText(
  h: PostureHistory,
  c: Exclude<PostureHistoryCase, { kind: "none" }>,
  labels: Record<HistoryPosture, string>,
): string {
  const parts: string[] = [];
  if (c.kind === "latest-silent") {
    parts.push(POSTURE_HISTORY_LATEST_SILENT(h.latestFy));
    if (h.other && c.nOther > 0) {
      const o = POSTURE_HISTORY_OTHER_ANSWER(c.nOther, h.other.fy);
      parts.push(`${o.before}${labels[h.other.posture]}${o.after}`);
    }
    if (c.third && c.nThird > 0) parts.push(POSTURE_HISTORY_ALSO_SAID(c.nThird, labels[c.third]));
  } else {
    parts.push(`Answer on the latest Form 990-PF return${h.latestFy !== null ? ` (FY${h.latestFy})` : ""}: ${labels[h.latestPosture]}.`);
    if (c.kind === "same") {
      parts.push(POSTURE_HISTORY_SAME(c.n, h.firstFy, h.lastFy));
    } else {
      parts.push(POSTURE_HISTORY_K_OF_N(c.k, c.n, h.firstFy, h.lastFy));
      if (h.other && c.nOther > 0) {
        const o = POSTURE_HISTORY_OTHER_ANSWER(c.nOther, h.other.fy);
        parts.push(`${o.before}${labels[h.other.posture]}${o.after}`);
      }
      if (c.nSilent > 0) parts.push(POSTURE_HISTORY_SILENT_COUNT(c.nSilent));
    }
  }
  parts.push("This counts past returns only. It does not say how the foundation will treat a new request.");
  return `Application answers across this foundation's Form 990-PF returns. ${parts.join(" ")}`;
}

/* ------------------------------------------------------------ seal labels */

/** Screen-reader label for the seal behind the earlier answer. */
export const POSTURE_HISTORY_OTHER_SOURCE_LABEL = (fy: number | null) =>
  fy !== null ? `Application policy as stated on the FY${fy} return` : "Application policy as stated on an earlier return";

export const TURNOVER_SOURCE_LABEL = (fy: number) => `Recipients on the FY${fy} grant list`;

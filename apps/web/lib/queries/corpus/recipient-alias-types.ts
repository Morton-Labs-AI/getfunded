/**
 * Shapes for "filers as witnesses": why a foundation's grant row carries a
 * link to an organization record when the foundation's own return gave no EIN.
 *
 * Plain types and one pure check, with no server-only import, so a component
 * on either side of the server / client boundary can use them. Everything is
 * serializable, like the rest of lib/queries/corpus/types.ts.
 */

/** Alias classes the corpus stores. Only "unanimous" is ever used to link a row. */
export type RecipientAliasStatus = "unanimous" | "dominant" | "contested";

/** The fewest independent filers a link may rest on (corpus rule, resolve/aliases.py). */
export const ALIAS_MIN_FILERS = 3;

export type RecipientAliasMatch = {
  /** The grant row (funding event) this explains. */
  eventId: string;
  /** Grant-making charities that wrote this name and state with the organization's EIN. */
  nFilers: number;
  status: RecipientAliasStatus;
  /** First and last fiscal year of the returns that are the evidence. Null when not on record. */
  firstFy: number | null;
  lastFy: number | null;
  /** Day the evidence was last counted, "YYYY-MM-DD" (UTC). */
  countedOn: string | null;
  /** Day this grant row was linked, "YYYY-MM-DD" (UTC). */
  linkedOn: string | null;
  /** Corpus dataset name of the alias row ("resolve_aliases") and its license code. */
  sourceDataset: string | null;
  license: string | null;
};

/**
 * True when the page may print the explanation sentence. A link is only ever
 * made from a "unanimous" alias with three or more filers; anything else here
 * means the stored evidence no longer says what the sentence says, and the
 * page then prints nothing rather than a claim it cannot back.
 */
export function isExplainableAliasMatch(m: RecipientAliasMatch | null | undefined): m is RecipientAliasMatch {
  return !!m && m.status === "unanimous" && Number.isFinite(m.nFilers) && m.nFilers >= ALIAS_MIN_FILERS;
}

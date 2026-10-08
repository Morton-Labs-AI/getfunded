/**
 * Copy for grant-row links that rest on other filers' returns ("filers as
 * witnesses"). Kept in its own file so it can be folded into copy.ts in one
 * step. The rules of copy.ts hold here too:
 *  - plain language for a nonprofit audience;
 *  - a number that drifts (the count of filers, the years, the date) is passed
 *    in, never written into the string;
 *  - nothing here says a funder is interested in anyone. The sentence states
 *    what was written on public returns and nothing more;
 *  - no model is involved, so nothing here is labelled AI.
 */
import { formatDate, formatNumber } from "@/lib/format";

/** Plain name of the corpus dataset `resolve_aliases`, for a DATASET_LABELS entry. */
export const RECIPIENT_ALIAS_DATASET_LABEL = "Recipient names matched through other filers' returns";

/**
 * Under a linked recipient name, when the link came from an alias. `nFilers`
 * is the number of grant-making charities that wrote this name and state with
 * the organization's EIN. It says "its EIN", not "the same organization": a
 * school's name is sometimes written with its parish's or its sponsor's EIN.
 */
export const RECIPIENT_ALIAS_MATCH_NOTE = (nFilers: number) =>
  `Matched to this organization because ${formatNumber(nFilers)} grant-making charities wrote this name with its EIN.`;

/**
 * Where that count comes from and when it was taken. Parts that are not on
 * record are left out; the sentence never shows a blank or a zero for them.
 */
export const RECIPIENT_ALIAS_SOURCE_NOTE = (opts: { firstFy: number | null; lastFy: number | null; countedOn: string | null }) => {
  const { firstFy, lastFy, countedOn } = opts;
  const years =
    firstFy !== null && lastFy !== null
      ? firstFy === lastFy
        ? `, fiscal year ${firstFy}`
        : `, fiscal years ${firstFy} to ${lastFy}`
      : "";
  const counted = countedOn ? ` Counted ${formatDate(countedOn)}.` : "";
  return `Source: Schedule I of their Form 990 returns${years}.${counted}`;
};

/**
 * One more sentence for the note under the grants table (append to
 * GRANTS_AS_REPORTED_NOTE with a space). It names the city test, because a
 * row is only linked when its city matches.
 */
export const GRANTS_ALIAS_LINKS_NOTE =
  "Some links come from other funders' returns: when three or more of them wrote the same name and state with one EIN, " +
  "and the city on this row matches, we use that EIN. The name on this row is still shown as this funder wrote it.";

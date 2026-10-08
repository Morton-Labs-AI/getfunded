/**
 * Search filter: leave out organizations the IRS automatically revoked.
 *
 * Pure, like lib/search/sql.ts: it builds text and touches no pool.
 *
 * URL key:   standing
 * Values:    hide_revoked  hide organizations whose IRS standing is "revoked"
 *            (absent)      no standing filter. This is the default: nothing is
 *                          ever hidden unless the reader asks for it.
 *            not_revoked   an older spelling of hide_revoked. It is still read
 *                          and is written back as hide_revoked.
 *
 * What "revoked" means is decided in ONE place, the corpus view
 * internal.org_irs_standing (corpus migration 0028): on the IRS automatic
 * revocation list, not reinstated on or after that revocation, and on neither
 * the IRS master file nor Publication 78. The filter therefore keeps:
 *   - organizations where the IRS lists disagree (both facts are shown);
 *   - organizations that were revoked once and are recognized again;
 *   - organizations on no list at all (an absence is not a finding);
 *   - companies and agencies, which the IRS lists do not cover;
 *   - every organization, when the two IRS lists are not both loaded
 *     (the view then has no standing for anyone, so nothing is hidden).
 *
 * Where it is wired:
 *
 *   1. lib/search/params.ts: `standing` in RawSchema, SearchParams (default
 *      null), parseSearchParams, toQueryString and FILTER_KEYS, so it shows as
 *      a removable chip (STANDING_FILTER_CHIP in lib/content/irs-standing-copy.ts).
 *
 *   2. lib/search/sql.ts, in buildSearchSql, next to the `postNtee` line, in
 *      the OUTER `where` (the page of at most a few hundred pool rows), not
 *      inside the pools. Each check is a handful of index lookups, which is
 *      nothing on a few hundred rows; inside a name pool it would run for
 *      every organization whose name matches a common word. The price: a
 *      pool can come up short by the revoked organizations that were in it.
 *      `total` is counted after the filter, so the count shown stays true.
 *      The fragment has no parameters, so `$n` numbering does not move.
 *
 *   3. lib/queries/corpus/search.ts passes `standingReadable: await
 *      canReadIrsStanding(sql)` (lib/queries/corpus/standing.ts). Until corpus
 *      0028 and getfunded_0013 are applied the view is not readable, and a
 *      query that names it would fail; with the probe the filter is simply
 *      off, the page says so, and the deploy order does not matter.
 */
import { z } from "zod";

/** The URL key. */
export const STANDING_PARAM = "standing";

export const STANDING_FILTERS = ["hide_revoked"] as const;
export type StandingFilter = (typeof STANDING_FILTERS)[number];

/** Older spellings that still work in a URL. Each one is read as the value on the right. */
const STANDING_ALIASES: Record<string, StandingFilter> = { not_revoked: "hide_revoked" };

/** For RawSchema in lib/search/params.ts. An unknown value is dropped, like every other key there. */
export const standingParamSchema = z
  .preprocess((v) => (typeof v === "string" ? (STANDING_ALIASES[v.trim().toLowerCase()] ?? v.trim().toLowerCase()) : v), z.enum(STANDING_FILTERS))
  .optional()
  .catch(undefined);

/** Parse one raw URL value. Anything that is not a known value is "no filter". */
export function parseStandingParam(raw: string | string[] | null | undefined): StandingFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = standingParamSchema.safeParse(typeof value === "string" ? value.trim() : undefined);
  return parsed.success ? (parsed.data ?? null) : null;
}

const ALIAS_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * SQL predicate, true for every organization EXCEPT the automatically revoked
 * ones. `orgAlias` is the alias of internal.organizations in the surrounding
 * query (`o` everywhere in lib/search/sql.ts). No parameters.
 *
 * It reads only `standing`, so Postgres drops the view's file and licence
 * joins; what is left is index lookups by primary key.
 */
export function excludeRevokedSql(orgAlias = "o"): string {
  if (!ALIAS_RE.test(orgAlias)) throw new Error(`excludeRevokedSql: not a plain SQL alias: ${orgAlias}`);
  return `not exists (
      select 1 from internal.org_irs_standing irs
      where irs.org_id = ${orgAlias}.id
        and irs.standing = 'revoked')`;
}

/** The predicate for a parsed value, or null when there is nothing to add. */
export function standingPredicate(standing: StandingFilter | null | undefined, orgAlias = "o"): string | null {
  return standing === "hide_revoked" ? excludeRevokedSql(orgAlias) : null;
}

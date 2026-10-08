/**
 * Search filter: leave out organizations the IRS automatically revoked.
 *
 * Pure, like lib/search/sql.ts: it builds text and touches no pool.
 *
 * URL key:   standing
 * Values:    hide_revoked  hide organizations whose IRS standing is "revoked",
 *                          except those that filed returns for later tax years
 *            (absent)      no standing filter. This is the default: nothing is
 *                          ever hidden unless the reader asks for it.
 *            not_revoked   an older spelling of hide_revoked. It is still read
 *                          and is written back as hide_revoked.
 *
 * What "revoked" means is decided in ONE place, the corpus view
 * internal.org_irs_standing (corpus migrations 0028 and 0032): on the IRS
 * automatic revocation list, not reinstated on or after that revocation, and
 * not on Publication 78. It is also not in the IRS master file, or the only
 * copy of the master file that names it is older than the day the IRS posted
 * the revocation (0032: the newer IRS list wins).
 *
 * One group of revoked organizations is NOT hidden: those that filed returns
 * for tax years after the revocation date (`filed_after_revocation` in the
 * same view, 0032). They are still on the IRS list as revoked, and the page
 * says so, but they kept filing, so a search must not lose them.
 *
 * The filter therefore keeps:
 *   - revoked organizations with a return for a later tax year;
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
 *
 *   4. Corpus 0032 adds the column `filed_after_revocation`. The predicate
 *      also runs on a database that does not have 0032 yet (see
 *      excludeRevokedSql). There it hides every revoked organization, as it
 *      did before 0032.
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
 * ones that have no return for a later tax year. `orgAlias` is the alias of
 * internal.organizations in the surrounding query (`o` everywhere in
 * lib/search/sql.ts). No parameters.
 *
 * It reads only `standing` and, for a revoked organization,
 * `filed_after_revocation`. Postgres drops the view's file and licence joins;
 * what is left is index lookups by primary key, plus one lookup of the
 * organization's returns by EIN when it is revoked.
 *
 * WHY THE EXTRA LEVEL. `filed_after_revocation` is written WITHOUT the `irs.`
 * prefix on purpose. SQL looks a bare column name up in the nearest query
 * level first, so on a database with corpus 0032 it is the view's column. On
 * a database without 0032 the view has no such column, and the name falls
 * back to the constant `false` one level out (`before_0032`). The statement
 * is therefore valid on both, and the deploy order does not matter. Do not
 * add the `irs.` prefix and do not move `before_0032` into the inner `from`.
 * When every database has 0032, this can become one level:
 * `irs.standing = 'revoked' and irs.filed_after_revocation is not true`.
 */
export function excludeRevokedSql(orgAlias = "o"): string {
  if (!ALIAS_RE.test(orgAlias)) throw new Error(`excludeRevokedSql: not a plain SQL alias: ${orgAlias}`);
  return `not exists (
      select 1 from (select false as filed_after_revocation) before_0032
      where exists (
        select 1 from internal.org_irs_standing irs
        where irs.org_id = ${orgAlias}.id
          and irs.standing = 'revoked'
          and filed_after_revocation is not true))`;
}

/** The predicate for a parsed value, or null when there is nothing to add. */
export function standingPredicate(standing: StandingFilter | null | undefined, orgAlias = "o"): string | null {
  return standing === "hide_revoked" ? excludeRevokedSql(orgAlias) : null;
}

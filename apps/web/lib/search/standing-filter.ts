/**
 * Search filter: leave out organizations the IRS automatically revoked.
 *
 * Pure, like lib/search/sql.ts: it builds text and touches no pool. It is not
 * wired into the search yet; the integrator adds it to lib/search/params.ts
 * and lib/search/sql.ts (see "Wiring" below).
 *
 * URL key:   standing
 * Values:    not_revoked   hide organizations whose IRS standing is "revoked"
 *            (absent)      no standing filter (today's behaviour)
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
 * Wiring (three small edits, none of them made here):
 *
 *   1. lib/search/params.ts: add `standing: standingParamSchema` to RawSchema,
 *      `standing: StandingFilter | null` to SearchParams (default null), set
 *      `standing: r.standing ?? null` in parseSearchParams, and in toQueryString
 *      `if (p.standing) sp.set(STANDING_PARAM, p.standing)`. Add "standing" to
 *      FilterKey / FILTER_KEYS so it shows as a removable chip
 *      (STANDING_FILTER_CHIP in lib/content/irs-standing-copy.ts).
 *
 *   2. lib/search/sql.ts, in buildSearchSql, next to the `postNtee` line:
 *
 *        if (p.standing === "not_revoked" && opts.standingReadable) where.push(excludeRevokedSql("o"));
 *
 *      Put it in that OUTER `where` (the page of at most a few hundred pool
 *      rows), not inside the pools. Each check is a handful of index lookups,
 *      which is nothing on a few hundred rows; inside a name pool it would run
 *      for every organization whose name matches a common word. The price: a
 *      pool can come up short by the revoked organizations that were in it.
 *      `total` is counted after the filter, so the count shown stays true.
 *      The fragment has no parameters, so `$n` numbering does not move.
 *
 *   3. lib/queries/corpus/search.ts: pass `standingReadable: await
 *      canReadIrsStanding(sql)` (lib/queries/corpus/standing.ts). Until corpus
 *      0028 and getfunded_0013 are applied the view is not readable, and a
 *      query that names it would fail; with the probe the filter is simply
 *      off, and the deploy order does not matter.
 */
import { z } from "zod";

/** The URL key. */
export const STANDING_PARAM = "standing";

export const STANDING_FILTERS = ["not_revoked"] as const;
export type StandingFilter = (typeof STANDING_FILTERS)[number];

/** For RawSchema in lib/search/params.ts. An unknown value is dropped, like every other key there. */
export const standingParamSchema = z.enum(STANDING_FILTERS).optional().catch(undefined);

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
  return standing === "not_revoked" ? excludeRevokedSql(orgAlias) : null;
}

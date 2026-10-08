import "server-only";

/**
 * Corpus read for IRS standing: is this organization still recognized today?
 *
 * One doctrine, kept in the database: every rule (which list wins, when a
 * reinstatement counts, the corrected 2020 revocation dates, "nothing until
 * BOTH lists are loaded", "a master-file copy older than the revocation does
 * not count") is in the view internal.org_irs_standing, corpus migrations 0028
 * and 0032. This file only reads that view and shapes the row.
 *
 *   - `getFunderStanding(orgId)` returns null when the organization has no
 *     EIN, is not a foundation or charity, or the two IRS lists are not both
 *     loaded. Null means "show nothing". It never means "listed".
 *   - The app role reads the view after web migration getfunded_0013. The
 *     grant is probed, so deploying the app before the migration is safe:
 *     the reader returns null until the grant is there.
 *   - Corpus migration 0032 adds two columns to the view:
 *     filed_after_revocation and latest_tax_period_end. They are probed too.
 *     On a database without 0032 the readers ask for NULL in their place, so
 *     the deploy order does not matter here either.
 *   - The dataset name, URL and licence of the deciding file come through the
 *     view (it runs with its owner's rights). The file fingerprint comes from
 *     internal.raw_files (id, sha256), the same way every other seal gets it.
 *   - `readFunderStanding(sql, orgId)` is the same read inside a transaction
 *     the caller already holds (the fit evidence package uses it).
 *   - `readStandingsByOrg(sql, orgIds)` reads one page of search results in a
 *     single statement, so a result card can carry the chip.
 *   - `getIrsStandingVintage()` returns the date of each IRS list for the
 *     data page. It is cached for hours and never throws.
 */
import { cache } from "react";
import { cacheLife } from "next/cache";
import type postgres from "postgres";

import { corpusQuery } from "@/lib/db/corpus";
import { irsSourceLabel } from "@/lib/content/irs-standing-copy";

import { isUuid } from "./safe";
import { canReadRawFileHash, rawFileHash } from "./sql-fragments";
import { IRS_STANDINGS, type IrsDateKind, type IrsStanding, type IrsStandingValue } from "./standing-types";

export type { IrsDateKind, IrsStanding, IrsStandingValue } from "./standing-types";
export { IRS_STANDINGS } from "./standing-types";

type Sql = postgres.Sql | postgres.TransactionSql;

/** A missing grant is checked again after this long, so a migration applied
 *  after the deploy is picked up without a restart. A found grant is kept. */
const PROBE_RETRY_MS = 60_000;

let standingReadable = false;
let standingRefined = false;
let standingProbedAt = 0;

/**
 * One catalog read for both questions: may this process read the view, and
 * does the view have the two columns of corpus 0032? Written so it cannot
 * raise inside the caller's transaction. A "yes" is kept; a "no" is asked
 * again after PROBE_RETRY_MS.
 */
async function probeIrsStanding(sql: Sql): Promise<void> {
  if (standingReadable && standingRefined) return;
  if (standingProbedAt && Date.now() - standingProbedAt < PROBE_RETRY_MS) return;
  try {
    const rows = await sql<{ ok: boolean | null; refined: boolean | null }[]>`
      select case when to_regclass('internal.org_irs_standing') is null then false
                  else has_table_privilege('internal.org_irs_standing', 'select') end as ok,
             (select count(*) = 2 from pg_attribute a
               where a.attrelid = to_regclass('internal.org_irs_standing')
                 and a.attname in ('filed_after_revocation', 'latest_tax_period_end')
                 and not a.attisdropped) as refined`;
    standingReadable = standingReadable || rows[0]?.ok === true;
    standingRefined = standingRefined || (rows[0]?.ok === true && rows[0]?.refined === true);
  } catch {
    // Keep what an earlier probe found; a failed read proves nothing new.
  }
  standingProbedAt = Date.now();
}

/**
 * Whether this process may read internal.org_irs_standing (corpus 0028 is
 * applied and getfunded_0013 granted it). The search filter in
 * lib/search/standing-filter.ts must only be added to a query when this is true.
 */
export async function canReadIrsStanding(sql: Sql): Promise<boolean> {
  await probeIrsStanding(sql);
  return standingReadable;
}

/**
 * Whether the view has the columns corpus 0032 adds (filed_after_revocation,
 * latest_tax_period_end). False until that migration is applied.
 */
export async function hasIrsStandingRefinements(sql: Sql): Promise<boolean> {
  await probeIrsStanding(sql);
  return standingRefined;
}

/** Test seam: forget the probe result. */
export function resetIrsStandingProbeForTests(): void {
  standingReadable = false;
  standingRefined = false;
  standingProbedAt = 0;
}

/**
 * The two columns of corpus 0032, or typed NULLs in their place on a database
 * that does not have them yet. `alias` is the view's alias in our own SQL.
 */
function refinementColumns(sql: Sql, refined: boolean, alias = "s") {
  return refined
    ? sql`${sql(alias)}.filed_after_revocation, ${sql(alias)}.latest_tax_period_end::text as latest_tax_period_end`
    : sql`null::boolean as filed_after_revocation, null::text as latest_tax_period_end`;
}

export type StandingRow = {
  org_id: string;
  ein: string;
  standing: string | null;
  in_bmf: boolean | null;
  bmf_as_of: string | null;
  bmf_as_of_kind: string | null;
  bmf_ruling_date: string | null;
  master_file_as_of: string | null;
  on_pub78: boolean | null;
  pub78_codes: string[] | null;
  revocation_date: string | null;
  effective_revocation_date: string | null;
  posting_date: string | null;
  reinstatement_date: string | null;
  reinstated: boolean | null;
  revocation_list_as_of: string | null;
  revocation_list_as_of_kind: string | null;
  pub78_as_of: string | null;
  pub78_as_of_kind: string | null;
  source_dataset: string | null;
  source_url: string | null;
  source_record_locator: string | null;
  license_name: string | null;
  sha256: string | null;
  /** Corpus 0032. Absent or null on a database without it, and when there is no revocation row. */
  filed_after_revocation?: boolean | null;
  /** Corpus 0032. Absent or null on a database without it, and when no return is on file. */
  latest_tax_period_end?: string | null;
};

function dateKind(v: string | null): IrsDateKind {
  return v === "irs_file_date" ? "irs_file_date" : "retrieved";
}

function isStanding(v: string | null): v is IrsStandingValue {
  return v !== null && (IRS_STANDINGS as readonly string[]).includes(v);
}

/**
 * Row -> IrsStanding, or null when the row cannot support a statement:
 * no standing (a list is not loaded), a value this build does not know, or a
 * missing list date. Exported for the integrator's fixtures and the styleguide.
 */
export function toIrsStanding(r: StandingRow): IrsStanding | null {
  if (!isStanding(r.standing)) return null;
  // Both lists, each with its date, or nothing at all.
  if (!r.revocation_list_as_of || !r.pub78_as_of) return null;
  const inBmf = r.in_bmf === true;
  return {
    orgId: r.org_id,
    ein: r.ein,
    standing: r.standing,
    inBmf,
    bmfAsOf: inBmf ? r.bmf_as_of : null,
    bmfAsOfKind: inBmf && r.bmf_as_of ? dateKind(r.bmf_as_of_kind) : null,
    bmfRulingDate: inBmf ? r.bmf_ruling_date : null,
    masterFileAsOf: r.master_file_as_of,
    onPub78: r.on_pub78 === true,
    pub78Codes: r.on_pub78 === true ? (r.pub78_codes ?? []) : [],
    pub78AsOf: r.pub78_as_of,
    pub78AsOfKind: dateKind(r.pub78_as_of_kind),
    revocationDate: r.revocation_date,
    effectiveRevocationDate: r.effective_revocation_date ?? r.revocation_date,
    postingDate: r.posting_date,
    reinstatementDate: r.reinstatement_date,
    reinstated: r.reinstated === true,
    revocationListAsOf: r.revocation_list_as_of,
    revocationListAsOfKind: dateKind(r.revocation_list_as_of_kind),
    filedAfterRevocation: r.filed_after_revocation === true,
    latestTaxPeriodEnd: r.latest_tax_period_end ?? null,
    provenance: {
      source: irsSourceLabel(r.source_dataset),
      filingYear: null,
      objectId: r.source_record_locator,
      sha256: r.sha256,
      href: r.source_url,
      license: r.license_name,
    },
  };
}

/**
 * One organization's IRS standing, read on a connection the caller already
 * holds. Returns null when the view cannot be read, when the organization has
 * no row, or when a list is not loaded. Index lookups only (see the view).
 */
export async function readFunderStanding(sql: Sql, orgId: string): Promise<IrsStanding | null> {
  if (!isUuid(orgId)) return null;
  if (!(await canReadIrsStanding(sql))) return null;
  const sha = await canReadRawFileHash(sql);
  const hash = rawFileHash(sql, sha, "s.raw_file_id", "irsrf");
  const refinements = refinementColumns(sql, await hasIrsStandingRefinements(sql));
  const rows = await sql<StandingRow[]>`
    select s.org_id::text as org_id, s.ein, s.standing,
           s.in_bmf, s.bmf_as_of::text as bmf_as_of, s.bmf_as_of_kind,
           s.bmf_ruling_date::text as bmf_ruling_date, s.master_file_as_of::text as master_file_as_of,
           s.on_pub78, s.pub78_codes,
           s.revocation_date::text as revocation_date,
           s.effective_revocation_date::text as effective_revocation_date,
           s.posting_date::text as posting_date,
           s.reinstatement_date::text as reinstatement_date, s.reinstated,
           s.revocation_list_as_of::text as revocation_list_as_of, s.revocation_list_as_of_kind,
           s.pub78_as_of::text as pub78_as_of, s.pub78_as_of_kind,
           s.source_dataset, s.source_url, s.source_record_locator, s.license_name,
           ${refinements},
           ${hash.column} as sha256
    from internal.org_irs_standing s
    ${hash.join}
    where s.org_id = ${orgId}::uuid
    order by s.ein
    limit 1`;
  const row = rows[0];
  return row ? toIrsStanding(row) : null;
}

/**
 * One organization's IRS standing, with the dates and the deciding file.
 * Memoised per request with React cache() so the header chip, the apply
 * section and "The basics" share one query.
 */
export const getFunderStanding = cache(async (orgId: string): Promise<IrsStanding | null> => {
  if (!isUuid(orgId)) return null;
  return corpusQuery((sql) => readFunderStanding(sql, orgId));
});

/** Most organizations one call reads (a search page holds 20). */
export const STANDINGS_MAX_ORGS = 100;

/**
 * IRS standing for a page of organizations, keyed by organization id, in one
 * statement. Organizations with no row (a company, an agency, no EIN) are
 * simply absent. Returns {} when the view cannot be read or no list is loaded.
 * An organization with two EINs gets the row of its first EIN, the same row
 * `readFunderStanding` returns.
 */
export async function readStandingsByOrg(sql: Sql, orgIds: readonly string[]): Promise<Record<string, IrsStanding>> {
  const ids = [...new Set(orgIds.filter(isUuid))].slice(0, STANDINGS_MAX_ORGS);
  if (ids.length === 0) return {};
  if (!(await canReadIrsStanding(sql))) return {};
  const sha = await canReadRawFileHash(sql);
  const hash = rawFileHash(sql, sha, "s.raw_file_id", "irsrf");
  const refinements = refinementColumns(sql, await hasIrsStandingRefinements(sql));
  const rows = await sql<StandingRow[]>`
    select distinct on (s.org_id)
           s.org_id::text as org_id, s.ein, s.standing,
           s.in_bmf, s.bmf_as_of::text as bmf_as_of, s.bmf_as_of_kind,
           s.bmf_ruling_date::text as bmf_ruling_date, s.master_file_as_of::text as master_file_as_of,
           s.on_pub78, s.pub78_codes,
           s.revocation_date::text as revocation_date,
           s.effective_revocation_date::text as effective_revocation_date,
           s.posting_date::text as posting_date,
           s.reinstatement_date::text as reinstatement_date, s.reinstated,
           s.revocation_list_as_of::text as revocation_list_as_of, s.revocation_list_as_of_kind,
           s.pub78_as_of::text as pub78_as_of, s.pub78_as_of_kind,
           s.source_dataset, s.source_url, s.source_record_locator, s.license_name,
           ${refinements},
           ${hash.column} as sha256
    from internal.org_irs_standing s
    ${hash.join}
    where s.org_id = any(${ids}::uuid[])
    order by s.org_id, s.ein`;
  const out: Record<string, IrsStanding> = {};
  for (const row of rows) {
    const standing = toIrsStanding(row);
    if (standing) out[row.org_id] = standing;
  }
  return out;
}

/* ---------------------------------------------------------------- vintage */

/** The date of one IRS list as this database holds it. */
export type IrsListDate = {
  /** `YYYY-MM-DD` (UTC). */
  asOf: string;
  /** "irs_file_date": the IRS server dated the file. "retrieved": the day we fetched it. */
  kind: IrsDateKind;
  /** Rows loaded from that file, or null when the count is not on record. */
  rows: number | null;
};

/** The two IRS lists behind IRS standing. A null list has never been loaded. */
export type IrsStandingVintage = {
  revocationList: IrsListDate | null;
  pub78: IrsListDate | null;
};

type VintageRow = {
  revocation_list_as_of: string | null;
  revocation_list_as_of_kind: string | null;
  revocation_list_rows: string | null;
  pub78_as_of: string | null;
  pub78_as_of_kind: string | null;
  pub78_rows: string | null;
};

function listDate(asOf: string | null, kind: string | null, rows: string | null): IrsListDate | null {
  if (!asOf) return null;
  const n = rows === null ? NaN : Number(rows);
  return { asOf, kind: dateKind(kind), rows: Number.isFinite(n) && n > 0 ? n : null };
}

/**
 * The date of each IRS list, from internal.irs_standing_vintage (one row,
 * NULL dates until a list is loaded). For pages that name the lists as
 * sources. Cached for hours. Never throws: null means the dates could not be
 * read (no database at build time, the migration or the grant is missing),
 * and the page then says "Not available".
 */
export async function getIrsStandingVintage(): Promise<IrsStandingVintage | null> {
  "use cache";
  cacheLife("hours");

  try {
    return await corpusQuery(async (sql) => {
      const rows = await sql<VintageRow[]>`
        select v.revocation_list_as_of::text as revocation_list_as_of, v.revocation_list_as_of_kind,
               v.revocation_list_rows::text as revocation_list_rows,
               v.pub78_as_of::text as pub78_as_of, v.pub78_as_of_kind,
               v.pub78_rows::text as pub78_rows
        from internal.irs_standing_vintage v
        limit 1`;
      const r = rows[0];
      if (!r) return { revocationList: null, pub78: null };
      return {
        revocationList: listDate(r.revocation_list_as_of, r.revocation_list_as_of_kind, r.revocation_list_rows),
        pub78: listDate(r.pub78_as_of, r.pub78_as_of_kind, r.pub78_rows),
      };
    });
  } catch {
    return null;
  }
}

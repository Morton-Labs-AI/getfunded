import "server-only";

/**
 * Corpus read for IRS standing: is this organization still recognized today?
 *
 * One doctrine, kept in the database: every rule (which list wins, when a
 * reinstatement counts, the corrected 2020 revocation dates, "nothing until
 * BOTH lists are loaded") is in the view internal.org_irs_standing, corpus
 * migration 0028. This file only reads that view and shapes the row.
 *
 *   - `getFunderStanding(orgId)` returns null when the organization has no
 *     EIN, is not a foundation or charity, or the two IRS lists are not both
 *     loaded. Null means "show nothing". It never means "listed".
 *   - The app role reads the view after web migration getfunded_0013. The
 *     grant is probed, so deploying the app before the migration is safe:
 *     the reader returns null until the grant is there.
 *   - The dataset name, URL and licence of the deciding file come through the
 *     view (it runs with its owner's rights). The file fingerprint comes from
 *     internal.raw_files (id, sha256), the same way every other seal gets it.
 */
import { cache } from "react";
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
let standingProbedAt = 0;

/**
 * Whether this process may read internal.org_irs_standing (corpus 0028 is
 * applied and getfunded_0013 granted it). Written so it cannot raise inside
 * the caller's transaction. The search filter in lib/search/standing-filter.ts
 * must only be added to a query when this is true.
 */
export async function canReadIrsStanding(sql: Sql): Promise<boolean> {
  if (standingReadable) return true;
  if (standingProbedAt && Date.now() - standingProbedAt < PROBE_RETRY_MS) return false;
  try {
    const rows = await sql<{ ok: boolean | null }[]>`
      select case when to_regclass('internal.org_irs_standing') is null then false
                  else has_table_privilege('internal.org_irs_standing', 'select') end as ok`;
    standingReadable = rows[0]?.ok === true;
  } catch {
    standingReadable = false;
  }
  standingProbedAt = Date.now();
  return standingReadable;
}

/** Test seam: forget the probe result. */
export function resetIrsStandingProbeForTests(): void {
  standingReadable = false;
  standingProbedAt = 0;
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
 * One organization's IRS standing, with the dates and the deciding file.
 * Index lookups only (see the view). Memoised per request with React cache()
 * so the header chip, the apply section and "The basics" share one query.
 */
export const getFunderStanding = cache(async (orgId: string): Promise<IrsStanding | null> => {
  if (!isUuid(orgId)) return null;
  const rows = await corpusQuery(async (sql) => {
    if (!(await canReadIrsStanding(sql))) return [] as StandingRow[];
    const sha = await canReadRawFileHash(sql);
    const hash = rawFileHash(sql, sha, "s.raw_file_id", "irsrf");
    return sql<StandingRow[]>`
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
             ${hash.column} as sha256
      from internal.org_irs_standing s
      ${hash.join}
      where s.org_id = ${orgId}::uuid
      order by s.ein
      limit 1`;
  });
  const row = rows[0];
  return row ? toIrsStanding(row) : null;
});

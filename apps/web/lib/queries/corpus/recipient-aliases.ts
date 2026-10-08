import "server-only";

/**
 * Corpus reads for "filers as witnesses" (corpus migration 0027).
 *
 * A Form 990-PF names a grant recipient but gives no EIN. Charities that file
 * Schedule I of Form 990 do write the EIN. When three or more of them wrote
 * the same name and state with one EIN, and the city on the foundation's row
 * matches, the corpus links that row to the same organization and records the
 * link in internal.recipient_alias_links. This file answers one question for
 * a page: "why does this grant row carry a link?" No model is involved.
 *
 * Two ways to use it; pick one:
 *   - getGrantAliasMatches(ids): a separate small query for the grant rows
 *     already on the page. Nothing in getFunderGrants has to change.
 *   - aliasMatchFragment(sql, readable) + aliasMatchFromRow(row): the join and
 *     the columns to add to an existing grants query (aliased `pe`), in the
 *     style of rawFileHash() in sql-fragments.ts.
 *
 * Doctrines:
 *   - Alias facts come from public.recipient_aliases, the license-filtered
 *     view, so the page can only show what the corpus may publish.
 *   - A link row counts only while the grant row still points at the alias's
 *     organization. If a later job or a person changed the link, the row gets
 *     no explanation from here.
 *   - The app role may read these relations only once web migration
 *     getfunded_0012 is applied. The grant is probed; until it is there every
 *     reader returns "no explanation" and the page renders as before, so the
 *     order of deploy and migrate does not matter.
 */
import type postgres from "postgres";

import { corpusQuery } from "@/lib/db/corpus";

import type { RecipientAliasMatch, RecipientAliasStatus } from "./recipient-alias-types";
import { isUuid, toInt } from "./safe";

type Sql = postgres.Sql | postgres.TransactionSql;

/** Most grant rows one call explains (the grants table shows at most 100 a page). */
export const ALIAS_MATCH_MAX_IDS = 200;

let aliasLinksReadable = false;

/**
 * Whether this process may read the alias relations. A "yes" is remembered
 * for the life of the process. A "no" is asked again on the next call (one
 * catalog lookup), so the explanation appears as soon as the migrations land,
 * without a redeploy. The probe is written so it cannot raise inside the
 * caller's transaction.
 */
export async function canReadAliasLinks(sql: Sql): Promise<boolean> {
  if (aliasLinksReadable) return true;
  try {
    const rows = await sql<{ ok: boolean | null }[]>`
      select case when to_regclass('internal.recipient_alias_links') is null
                    or to_regclass('public.recipient_aliases') is null then false
                  else has_table_privilege('internal.recipient_alias_links', 'select')
                       and has_table_privilege('public.recipient_aliases', 'select') end as ok`;
    aliasLinksReadable = rows[0]?.ok === true;
  } catch {
    aliasLinksReadable = false;
  }
  return aliasLinksReadable;
}

/** Test seam: forget the probe result. */
export function resetAliasLinksProbeForTests(): void {
  aliasLinksReadable = false;
}

/** The alias columns as a grants query returns them (see aliasMatchFragment). */
export type AliasMatchColumns = {
  alias_filers: number | string | null;
  alias_status: string | null;
  alias_first_fy: number | string | null;
  alias_last_fy: number | string | null;
  alias_counted_on: string | null;
  alias_linked_on: string | null;
  alias_source_dataset: string | null;
  alias_license: string | null;
};

const STATUSES: readonly RecipientAliasStatus[] = ["unanimous", "dominant", "contested"];

/** One row's alias columns as a RecipientAliasMatch, or null when the row has no alias link. */
export function aliasMatchFromRow(eventId: string, row: AliasMatchColumns): RecipientAliasMatch | null {
  const nFilers = toInt(row.alias_filers);
  const status = STATUSES.find((s) => s === row.alias_status);
  if (nFilers === null || !status) return null;
  return {
    eventId,
    nFilers,
    status,
    firstFy: toInt(row.alias_first_fy),
    lastFy: toInt(row.alias_last_fy),
    countedOn: row.alias_counted_on,
    linkedOn: row.alias_linked_on,
    sourceDataset: row.alias_source_dataset,
    license: row.alias_license,
  };
}

/**
 * The two halves of an alias lookup inside a grants query whose
 * public.funding_events view is aliased `pe`: the joins, and the eight
 * `alias_*` columns (nulls when the grant is not there yet). Use both or
 * neither. The second join keeps a link only while the row still points at
 * the alias's organization.
 */
export function aliasMatchFragment(sql: Sql, readable: boolean) {
  return {
    join: readable
      ? sql`left join internal.recipient_alias_links al on al.event_id = pe.id
            left join public.recipient_aliases ra on ra.id = al.alias_id and ra.org_id = pe.recipient_org_id`
      : sql``,
    columns: readable
      ? sql`ra.n_filers as alias_filers, ra.status as alias_status,
            ra.first_fy as alias_first_fy, ra.last_fy as alias_last_fy,
            to_char(ra.updated_at at time zone 'UTC', 'YYYY-MM-DD') as alias_counted_on,
            to_char(al.linked_at at time zone 'UTC', 'YYYY-MM-DD') as alias_linked_on,
            ra.source_dataset as alias_source_dataset, ra.license_code as alias_license`
      : sql`null::int as alias_filers, null::text as alias_status,
            null::int as alias_first_fy, null::int as alias_last_fy,
            null::text as alias_counted_on, null::text as alias_linked_on,
            null::text as alias_source_dataset, null::text as alias_license`,
  };
}

/**
 * Explanations for the grant rows on a page, keyed by grant row id. Rows with
 * no alias link are simply absent. Returns {} when the ids are empty, when
 * none is a uuid, or when the app role cannot read the alias relations yet.
 */
export async function getGrantAliasMatches(eventIds: readonly string[]): Promise<Record<string, RecipientAliasMatch>> {
  const ids = [...new Set(eventIds.filter(isUuid))].slice(0, ALIAS_MATCH_MAX_IDS);
  if (ids.length === 0) return {};
  const rows = await corpusQuery(async (sql) => {
    if (!(await canReadAliasLinks(sql))) return [];
    return sql<({ event_id: string } & AliasMatchColumns)[]>`
      select al.event_id::text as event_id,
             ra.n_filers as alias_filers, ra.status as alias_status,
             ra.first_fy as alias_first_fy, ra.last_fy as alias_last_fy,
             to_char(ra.updated_at at time zone 'UTC', 'YYYY-MM-DD') as alias_counted_on,
             to_char(al.linked_at at time zone 'UTC', 'YYYY-MM-DD') as alias_linked_on,
             ra.source_dataset as alias_source_dataset, ra.license_code as alias_license
      from internal.recipient_alias_links al
      join public.recipient_aliases ra on ra.id = al.alias_id
      join internal.funding_events fe on fe.id = al.event_id
      where al.event_id = any(${ids}::uuid[])
        and fe.recipient_org_id = ra.org_id`;
  });
  const out: Record<string, RecipientAliasMatch> = {};
  for (const r of rows) {
    const m = aliasMatchFromRow(r.event_id, r);
    if (m) out[r.event_id] = m;
  }
  return out;
}

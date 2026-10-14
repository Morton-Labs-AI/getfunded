import "server-only";

/**
 * Corpus read for funder signals (internal.funder_signals, corpus migration
 * 0035).
 *
 *   - Published, republishable rows only, read through the view
 *     public.funder_signals, which applies both filters (status = 'published'
 *     and the licensing_map check on the row's compilation file) and is the
 *     only place the dataset name and licence come from. The app role holds
 *     no grant on internal.licensing_map and only (id, sha256) on
 *     internal.raw_files (getfunded_0010), so it must not join those itself:
 *     before getfunded_0017 this file did, and every funder page raised
 *     "permission denied for table raw_files".
 *   - The org links come from internal.funder_signal_orgs (getfunded_0015,
 *     indexed on org_id); the inner join to the view drops any link to a
 *     signal that is not published.
 *   - The file fingerprint comes from internal.raw_files (id, sha256) through
 *     internal.funder_signals.raw_file_id, probed like every other seal
 *     (sql-fragments.ts canReadRawFileHash).
 *   - The grants are probed, so deploying the app before getfunded_0017 is
 *     safe: every reader returns [] (and raises nothing) until it is there.
 *   - The page gets the facts (headline, date, type, amount, chips) and the
 *     model's paraphrase, each labelled by its class on the page. raw_source
 *     (verbatim excerpts) is never read here.
 */
import { cache } from "react";
import type postgres from "postgres";

import { corpusQuery } from "@/lib/db/corpus";

import { isUuid } from "./safe";
import { canReadRawFileHash } from "./sql-fragments";

type Sql = postgres.Sql | postgres.TransactionSql;

const PROBE_RETRY_MS = 60_000;
let signalsReadable = false;
let signalsProbedAt = 0;

/** Whether this process may read internal.funder_signals. Never raises. */
export async function canReadSignals(sql: Sql): Promise<boolean> {
  if (signalsReadable) return true;
  if (signalsProbedAt && Date.now() - signalsProbedAt < PROBE_RETRY_MS) return false;
  try {
    const rows = await sql<{ ok: boolean | null }[]>`
      select case when to_regclass('public.funder_signals') is null
                    or to_regclass('internal.funder_signal_orgs') is null then false
                  else has_table_privilege('public.funder_signals', 'select')
                   and has_table_privilege('internal.funder_signal_orgs', 'select') end as ok`;
    signalsReadable = rows[0]?.ok === true;
  } catch {
    signalsReadable = false;
  }
  signalsProbedAt = Date.now();
  return signalsReadable;
}

export function resetSignalsProbeForTests(): void {
  signalsReadable = false;
  signalsProbedAt = 0;
}

export type FunderSignal = {
  id: number;
  url: string;
  publisher: string | null;
  headline: string | null;
  /** `YYYY-MM-DD` or null when the page did not state a date. */
  publishedAt: string | null;
  discoveredAt: string;
  signalType: string | null;
  amountUsd: number | null;
  amountKind: string | null;
  instruments: string[];
  eligibleRecipients: string[];
  sectors: string[];
  geographies: string[];
  horizonEnd: string | null;
  /** The model's paraphrase (AI class on the page). */
  summary: string | null;
  actionHint: string | null;
  extractionModel: string | null;
  extractionConfidence: number | null;
  /** How this signal was tied to the organization: source_feed, ein, name, manual, model. */
  matchMethod: string;
  orgId: string;
  orgName: string | null;
  /** Dataset + licence of OUR compilation file (the row's provenance). */
  sourceDataset: string | null;
  licenseName: string | null;
  sha256: string | null;
};

type Row = {
  id: string;
  url: string;
  publisher: string | null;
  headline: string | null;
  published_at: string | null;
  discovered_at: string;
  signal_type: string | null;
  amount_usd: string | null;
  amount_kind: string | null;
  instruments: string[] | null;
  eligible_recipients: string[] | null;
  sectors: string[] | null;
  geographies: string[] | null;
  horizon_end: string | null;
  summary: string | null;
  action_hint: string | null;
  extraction_model: string | null;
  extraction_confidence: number | null;
  match_method: string;
  org_id: string;
  org_name: string | null;
  source_dataset: string | null;
  license_name: string | null;
  sha256: string | null;
};

function toSignal(r: Row): FunderSignal {
  const amount = r.amount_usd === null ? null : Number(r.amount_usd);
  return {
    id: Number(r.id),
    url: r.url,
    publisher: r.publisher,
    headline: r.headline,
    publishedAt: r.published_at,
    discoveredAt: r.discovered_at,
    signalType: r.signal_type,
    amountUsd: amount !== null && Number.isFinite(amount) ? amount : null,
    amountKind: r.amount_kind,
    instruments: r.instruments ?? [],
    eligibleRecipients: r.eligible_recipients ?? [],
    sectors: r.sectors ?? [],
    geographies: r.geographies ?? [],
    horizonEnd: r.horizon_end,
    summary: r.summary,
    actionHint: r.action_hint,
    extractionModel: r.extraction_model,
    extractionConfidence: r.extraction_confidence,
    matchMethod: r.match_method,
    orgId: r.org_id,
    orgName: r.org_name,
    sourceDataset: r.source_dataset,
    licenseName: r.license_name,
    sha256: r.sha256,
  };
}

/**
 * The select list and joins shared by both readers. `ps` is the public view
 * (published, licence-filtered); `so` the org link. With `withHash` the
 * fingerprint of the compilation file is joined through the two columns the
 * app role may read; without it the column is null and the seal leaves it out.
 */
function signalsFrom(withHash: boolean): string {
  return `
  select
    ps.id::text as id, ps.url, ps.publisher, ps.headline,
    ps.published_at::text as published_at, ps.discovered_at::text as discovered_at,
    ps.signal_type, ps.amount_usd::text as amount_usd, ps.amount_kind,
    ps.instruments, ps.eligible_recipients, ps.sectors, ps.geographies,
    ps.horizon_end::text as horizon_end, ps.summary, ps.action_hint,
    ps.extraction_model, ps.extraction_confidence,
    so.match_method, so.org_id::text as org_id, o.name as org_name,
    ps.source_dataset, ps.license_name,
    ${withHash ? "rf.sha256" : "null::text"} as sha256
  from internal.funder_signal_orgs so
  join public.funder_signals ps on ps.id = so.signal_id
  join internal.organizations o on o.id = so.org_id
  ${
    withHash
      ? `left join internal.funder_signals s on s.id = ps.id
  left join internal.raw_files rf on rf.id = s.raw_file_id`
      : ""
  }`;
}

/** SQL for one organization's signals. $1 = org id, $2 = limit. Exported for the grant test. */
export function signalsForOrgSql(withHash: boolean): string {
  return `${signalsFrom(withHash)}
  where so.org_id = $1::uuid
  order by ps.published_at desc nulls last, ps.id desc
  limit $2`;
}

/** SQL for a set of organizations (subject links only). $1 = uuid[], $2 = limit. */
export function signalsForOrgsSql(withHash: boolean): string {
  return `${signalsFrom(withHash)}
  where so.org_id = any($1::uuid[]) and so.role = 'subject'
  order by ps.published_at desc nulls last, ps.id desc
  limit $2`;
}

/** Published signals about one organization, newest first. [] when unreadable. */
export async function readSignalsForOrg(sql: Sql, orgId: string, limit = 12): Promise<FunderSignal[]> {
  if (!isUuid(orgId)) return [];
  if (!(await canReadSignals(sql))) return [];
  const withHash = await canReadRawFileHash(sql);
  const rows = await sql.unsafe<Row[]>(signalsForOrgSql(withHash), [orgId, limit]);
  return rows.map(toSignal);
}

export const getFunderSignals = cache(async (orgId: string): Promise<FunderSignal[]> => {
  if (!isUuid(orgId)) return [];
  return corpusQuery((sql) => readSignalsForOrg(sql, orgId));
});

/**
 * Published signals about a set of organizations (a workspace's saved
 * funders), newest first, for the dashboard. Reads at most `limit` rows.
 */
export async function readSignalsForOrgs(sql: Sql, orgIds: readonly string[], limit = 8): Promise<FunderSignal[]> {
  const ids = [...new Set(orgIds.filter(isUuid))].slice(0, 500);
  if (ids.length === 0) return [];
  if (!(await canReadSignals(sql))) return [];
  const withHash = await canReadRawFileHash(sql);
  const rows = await sql.unsafe<Row[]>(signalsForOrgsSql(withHash), [ids, limit]);
  return rows.map(toSignal);
}

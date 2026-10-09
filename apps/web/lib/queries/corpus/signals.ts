import "server-only";

/**
 * Corpus read for funder signals (internal.funder_signals, corpus migration
 * 0032; the app role reads it after web migration getfunded_0015).
 *
 *   - Published rows only. A candidate never leaves the review queue.
 *   - The grant is probed, so deploying the app before the migration is safe:
 *     every reader returns [] until the grant is there.
 *   - The page gets the facts (headline, date, type, amount, chips) and the
 *     model's paraphrase, each labelled by its class on the page. raw_source
 *     (verbatim excerpts) is never read here.
 */
import { cache } from "react";
import type postgres from "postgres";

import { corpusQuery } from "@/lib/db/corpus";

import { isUuid } from "./safe";

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
      select case when to_regclass('internal.funder_signals') is null then false
                  else has_table_privilege('internal.funder_signals', 'select')
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

const COLUMNS = `
  s.id::text as id, s.url, s.publisher, s.headline,
  s.published_at::text as published_at, s.discovered_at::text as discovered_at,
  s.signal_type, s.amount_usd::text as amount_usd, s.amount_kind,
  s.instruments, s.eligible_recipients, s.sectors, s.geographies,
  s.horizon_end::text as horizon_end, s.summary, s.action_hint,
  s.extraction_model, s.extraction_confidence,
  so.match_method, so.org_id::text as org_id, o.name as org_name,
  rf.dataset_name as source_dataset, lm.license_name,
  case when has_table_privilege('internal.raw_files', 'select') then rf.sha256 else null end as sha256`;

/** Published signals about one organization, newest first. [] when unreadable. */
export async function readSignalsForOrg(sql: Sql, orgId: string, limit = 12): Promise<FunderSignal[]> {
  if (!isUuid(orgId)) return [];
  if (!(await canReadSignals(sql))) return [];
  const rows = await sql.unsafe<Row[]>(
    `select ${COLUMNS}
     from internal.funder_signals s
     join internal.funder_signal_orgs so on so.signal_id = s.id and so.org_id = $1::uuid
     join internal.organizations o on o.id = so.org_id
     join internal.raw_files rf on rf.id = s.raw_file_id
     join internal.licensing_map lm on lm.license_code = rf.license_code
     where s.status = 'published' and lm.republishable
     order by s.published_at desc nulls last, s.id desc
     limit $2`,
    [orgId, limit],
  );
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
  const rows = await sql.unsafe<Row[]>(
    `select ${COLUMNS}
     from internal.funder_signals s
     join internal.funder_signal_orgs so on so.signal_id = s.id and so.role = 'subject' and so.org_id = any($1::uuid[])
     join internal.organizations o on o.id = so.org_id
     join internal.raw_files rf on rf.id = s.raw_file_id
     join internal.licensing_map lm on lm.license_code = rf.license_code
     where s.status = 'published' and lm.republishable
     order by s.published_at desc nulls last, s.id desc
     limit $2`,
    [ids, limit],
  );
  return rows.map(toSignal);
}

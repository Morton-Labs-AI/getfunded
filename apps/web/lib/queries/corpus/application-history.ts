import "server-only";

/**
 * Corpus read for "what its returns show": the application answer across a
 * foundation's Form 990-PF returns, and how many of a year's named grant
 * recipients were on none of its lists for the three years before.
 *
 * The rules live in the database and the corpus job, not here:
 *   - internal.mv_org_posture_history (corpus migration 0029) counts the
 *     answers. It starts from the same per-filing rows as
 *     mv_org_application_posture, so "latest return" means the same filing in
 *     both;
 *   - internal.funder_recipient_turnover is filled by `funderdb derive
 *     turnover`. A foundation has a row only when it has named grant rows in
 *     the fiscal year and in each of the three years before. No row means
 *     "cannot tell"; this reader never turns that into a zero.
 * This file only reads the rows and attaches a seal to each.
 *
 *   - `getFunderApplicationHistory(orgId)` returns null when there is nothing
 *     to show. Null means "show nothing".
 *   - The app role reads both relations after web migration getfunded_0014.
 *     The grant is probed, so deploying the app before the migration is safe:
 *     the reader returns null until the grant is there.
 *   - Every seal comes from public.filings (dataset, URL, licence; only
 *     republishable sources) plus the file fingerprint from
 *     internal.raw_files (id, sha256), the same way every other filing seal
 *     gets it. A filing that was superseded after the count gets no seal, and
 *     the component then prints nothing for that line.
 */
import { cache } from "react";
import type postgres from "postgres";

import { datasetLabel } from "@/lib/content/labels";
import { corpusQuery } from "@/lib/db/corpus";

import type { ApplicationHistory, HistoryPosture, PostureHistory, RecipientTurnover, StatedPosture } from "./application-history-types";
import { isUuid } from "./safe";
import { canReadRawFileHash, rawFileHash } from "./sql-fragments";
import type { Provenance } from "./types";

export type {
  ApplicationHistory,
  HistoryPosture,
  PostureHistory,
  PostureHistoryCase,
  RecipientTurnover,
  StatedPosture,
} from "./application-history-types";
export { historyMatchesBadge, postureHistoryCase, showableTurnover } from "./application-history-types";

type Sql = postgres.Sql | postgres.TransactionSql;

/** A missing grant is checked again after this long, so a migration applied
 *  after the deploy is picked up without a restart. A found grant is kept. */
const PROBE_RETRY_MS = 60_000;

type Readable = { history: boolean; turnover: boolean };

let readable: Readable = { history: false, turnover: false };
let probedAt = 0;

/**
 * Which of the two relations this process may read (corpus 0029 applied and
 * getfunded_0014 granted). Written so it cannot raise inside the caller's
 * transaction.
 */
export async function canReadApplicationHistory(sql: Sql): Promise<Readable> {
  if (readable.history && readable.turnover) return readable;
  if (probedAt && Date.now() - probedAt < PROBE_RETRY_MS) return readable;
  try {
    const rows = await sql<{ history: boolean | null; turnover: boolean | null }[]>`
      select case when to_regclass('internal.mv_org_posture_history') is null then false
                  else has_table_privilege('internal.mv_org_posture_history', 'select') end as history,
             case when to_regclass('internal.funder_recipient_turnover') is null then false
                  else has_table_privilege('internal.funder_recipient_turnover', 'select') end as turnover`;
    readable = { history: rows[0]?.history === true, turnover: rows[0]?.turnover === true };
  } catch {
    readable = { history: false, turnover: false };
  }
  probedAt = Date.now();
  return readable;
}

/** Test seam: forget the probe result. */
export function resetApplicationHistoryProbeForTests(): void {
  readable = { history: false, turnover: false };
  probedAt = 0;
}

export type PostureHistoryRow = {
  n_returns: number;
  n_open: number;
  n_preselected: number;
  n_not_stated: number;
  first_fy: number | null;
  last_fy: number | null;
  latest_posture: string | null;
  latest_fy: number | null;
  latest_object_id: string | null;
  other_posture: string | null;
  other_fy: number | null;
  other_object_id: string | null;
  restrictive_phrase: string | null;
  /** Null when the latest filing is not in public.filings (not republishable) or is superseded now. */
  latest_sealed: string | null;
  latest_source_dataset: string | null;
  latest_source_url: string | null;
  latest_license: string | null;
  latest_sha256: string | null;
  other_sealed: string | null;
  other_source_dataset: string | null;
  other_source_url: string | null;
  other_license: string | null;
  other_sha256: string | null;
};

export type RecipientTurnoverRow = {
  fy: number;
  n_recipients: number;
  n_new: number;
  n_seen_similar: number;
  window_first_fy: number;
  window_last_fy: number;
  n_rows: number;
  n_unnamed_rows: number;
  window_unnamed_rows: number;
  object_id: string | null;
  rule_version: string;
  sealed: string | null;
  source_dataset: string | null;
  source_url: string | null;
  license_name: string | null;
  sha256: string | null;
};

function seal(
  sealed: string | null,
  fy: number | null,
  dataset: string | null,
  url: string | null,
  license: string | null,
  sha256: string | null,
): Provenance | null {
  if (!sealed) return null;
  return {
    source: datasetLabel(dataset, "IRS 990-PF e-file"),
    filingYear: fy,
    objectId: sealed,
    sha256,
    href: url,
    license,
  };
}

function historyPosture(v: string | null): HistoryPosture | null {
  return v === "open" ? "open" : v === "preselected_only" ? "preselected" : v === "unknown" ? "unknown" : null;
}

function statedPosture(v: string | null): StatedPosture | null {
  return v === "open" ? "open" : v === "preselected_only" ? "preselected" : null;
}

/** Row -> PostureHistory, or null when the row cannot support a sentence. Exported for fixtures and the styleguide. */
export function toPostureHistory(r: PostureHistoryRow): PostureHistory | null {
  const latestPosture = historyPosture(r.latest_posture);
  if (!latestPosture || !r.latest_object_id) return null;
  const otherPosture = statedPosture(r.other_posture);
  return {
    nReturns: r.n_returns,
    nOpen: r.n_open,
    nPreselected: r.n_preselected,
    nNotStated: r.n_not_stated,
    firstFy: r.first_fy,
    lastFy: r.last_fy,
    latestPosture,
    latestFy: r.latest_fy,
    latestObjectId: r.latest_object_id,
    provenance: seal(r.latest_sealed, r.latest_fy, r.latest_source_dataset, r.latest_source_url, r.latest_license, r.latest_sha256),
    other:
      otherPosture && r.other_object_id
        ? {
            posture: otherPosture,
            fy: r.other_fy,
            objectId: r.other_object_id,
            provenance: seal(r.other_sealed, r.other_fy, r.other_source_dataset, r.other_source_url, r.other_license, r.other_sha256),
          }
        : null,
    restrictivePhrase: latestPosture === "open" ? r.restrictive_phrase?.trim() || null : null,
  };
}

/** Row -> RecipientTurnover. Exported for fixtures and the styleguide. */
export function toRecipientTurnover(r: RecipientTurnoverRow): RecipientTurnover {
  return {
    fy: r.fy,
    nRecipients: r.n_recipients,
    nNew: r.n_new,
    nSeenSimilar: r.n_seen_similar,
    windowFirstFy: r.window_first_fy,
    windowLastFy: r.window_last_fy,
    nRows: r.n_rows,
    nUnnamedRows: r.n_unnamed_rows,
    windowUnnamedRows: r.window_unnamed_rows,
    objectId: r.object_id,
    ruleVersion: r.rule_version,
    provenance: seal(r.sealed, r.fy, r.source_dataset, r.source_url, r.license_name, r.sha256),
  };
}

/**
 * The application answer across returns and up to three fiscal years of
 * recipient turnover (newest first) for one foundation, or null when neither
 * is on record or readable. Memoised per request.
 */
export const getFunderApplicationHistory = cache(async (orgId: string): Promise<ApplicationHistory | null> => {
  if (!isUuid(orgId)) return null;
  return corpusQuery(async (sql) => {
    const can = await canReadApplicationHistory(sql);
    if (!can.history && !can.turnover) return null;
    const sha = await canReadRawFileHash(sql);

    let history: PostureHistory | null = null;
    if (can.history) {
      const latestHash = rawFileHash(sql, sha, "h.raw_file_id", "hrf");
      const otherHash = rawFileHash(sql, sha, "h.other_raw_file_id", "horf");
      const rows = await sql<PostureHistoryRow[]>`
        select h.n_returns, h.n_open, h.n_preselected, h.n_not_stated,
               h.first_fy, h.last_fy,
               h.latest_posture, h.latest_fy, h.latest_object_id,
               h.other_posture, h.other_fy, h.other_object_id,
               h.restrictive_phrase,
               lf.object_id as latest_sealed, lf.source_dataset as latest_source_dataset,
               lf.source_url as latest_source_url, lf.license_name as latest_license,
               ${latestHash.column} as latest_sha256,
               ef.object_id as other_sealed, ef.source_dataset as other_source_dataset,
               ef.source_url as other_source_url, ef.license_name as other_license,
               ${otherHash.column} as other_sha256
        from internal.mv_org_posture_history h
        -- Seals from public.filings: only republishable sources, and only a
        -- filing that is still the current one for its period.
        left join public.filings lf
          on lf.object_id = h.latest_object_id and lf.superseded_by_object_id is null
        ${latestHash.join}
        left join public.filings ef
          on ef.object_id = h.other_object_id and ef.superseded_by_object_id is null
        ${otherHash.join}
        where h.org_id = ${orgId}::uuid`;
      history = rows[0] ? toPostureHistory(rows[0]) : null;
    }

    let turnover: RecipientTurnover[] = [];
    if (can.turnover) {
      const hash = rawFileHash(sql, sha, "tif.raw_file_id", "trf");
      const rows = await sql<RecipientTurnoverRow[]>`
        select t.fy, t.n_recipients, t.n_new, t.n_seen_similar,
               t.window_first_fy, t.window_last_fy,
               t.n_rows, t.n_unnamed_rows, t.window_unnamed_rows,
               t.object_id, t.rule_version,
               tf.object_id as sealed, tf.source_dataset, tf.source_url, tf.license_name,
               ${hash.column} as sha256
        from internal.funder_recipient_turnover t
        left join public.filings tf
          on tf.object_id = t.object_id and tf.superseded_by_object_id is null
        left join internal.filings tif on tif.object_id = tf.object_id
        ${hash.join}
        where t.funder_org_id = ${orgId}::uuid
        order by t.fy desc
        limit 3`;
      turnover = rows.map(toRecipientTurnover);
    }

    return history || turnover.length > 0 ? { history, turnover } : null;
  });
});

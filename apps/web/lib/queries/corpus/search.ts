import "server-only";

/**
 * Free funder search over the corpus plane. Read-only by construction
 * (corpusQuery opens BEGIN READ ONLY with a statement timeout) and bounded
 * by a candidate pool (lib/search/sql.ts). No account, no credits.
 */
import type postgres from "postgres";

import type { PostureValue } from "@/components/data/posture";
import { DbError } from "@/lib/db/app";
import { corpusQuery } from "@/lib/db/corpus";
import { formatEin } from "@/lib/format";
import { IRS_MASTER_FILE_LABEL } from "@/lib/content/copy";
import { filingSourceLabel, nteeMajorLabel, orgTypeLabel } from "@/lib/content/labels";
import { embedQuery } from "@/lib/search/embed";
import { PAGE_SIZE, nameQuery, type SearchParams } from "@/lib/search/params";
import { buildSearchSql, type RanMode } from "@/lib/search/sql";

import { positive, toInt } from "./safe";
import type { GivingToEvidence, SearchHit, SearchResult } from "./types";

export type SearchDeps = {
  /** Runs `fn` against a SQL handle. Defaults to corpusQuery. Tests pass a fake. */
  run?: <T>(fn: (sql: postgres.TransactionSql) => Promise<T>) => Promise<T>;
  embed?: (text: string) => Promise<number[] | null>;
};

type Row = {
  id: string;
  name: string;
  org_type: string;
  city: string | null;
  state: string | null;
  ntee_code: string | null;
  focus_areas: string[] | null;
  website: string | null;
  bmf_assets: string | null;
  ein: string | null;
  application_posture: string | null;
  posture_fy: number | null;
  fin_fy: number | null;
  fin_return_type: string | null;
  fin_object_id: string | null;
  qualifying_distributions: string | null;
  charitable_disbursements: string | null;
  total_assets_eoy: string | null;
  grants_n: string | null;
  grants_total: string | null;
  grants_last_fy: number | null;
  rank: number | null;
  snippet: string | null;
  hit_n?: number | null;
  hit_total?: string | null;
  hit_samples?: (string | null)[] | null;
  total: number;
  pool_size: number;
};

export function postureFromDb(v: string | null | undefined): PostureValue | null {
  switch (v) {
    case "open":
      return "open";
    case "preselected_only":
      return "preselected";
    case "unknown":
      return "unknown";
    default:
      return null;
  }
}

function reasonFor(ran: RanMode, p: SearchParams, row: Row): string | null {
  switch (ran) {
    case "ein":
      return `EIN ${formatEin(p.ein)} matches`;
    case "name":
      return `Name contains “${nameQuery(p) ?? p.q ?? ""}”`;
    case "keyword":
      return row.snippet ? "Keywords matched the giving summary" : "Keywords matched the name or location";
    case "semantic":
      return "Giving summary reads like what you described";
    default:
      return null;
  }
}

function givingToOf(row: Row): GivingToEvidence | null {
  if (row.hit_n === undefined || row.hit_n === null || row.hit_n <= 0) return null;
  return {
    n: row.hit_n,
    total: positive(row.hit_total ?? null),
    samples: (row.hit_samples ?? []).filter((s): s is string => typeof s === "string" && s.trim().length > 0),
  };
}

export function rowToHit(row: Row, ran: RanMode, p: SearchParams): SearchHit {
  const filing = row.fin_fy && row.fin_object_id ? { fy: row.fin_fy, returnType: row.fin_return_type ?? "990", objectId: row.fin_object_id } : null;
  const distributions = positive(row.qualifying_distributions) ?? positive(row.charitable_disbursements);
  const filingAssets = positive(row.total_assets_eoy);
  const bmfAssets = positive(row.bmf_assets);
  const nteeLabel = nteeMajorLabel(row.ntee_code);
  const programAreas = [nteeLabel, ...(row.focus_areas ?? [])].filter((s): s is string => Boolean(s)).slice(0, 4);
  return {
    orgId: row.id,
    name: row.name,
    orgType: row.org_type,
    orgTypeLabel: orgTypeLabel(row.org_type),
    ein: row.ein ? row.ein.trim() : null,
    city: row.city,
    state: row.state,
    website: row.website,
    nteeCode: row.ntee_code,
    nteeLabel,
    programAreas,
    posture: postureFromDb(row.application_posture),
    postureFy: row.posture_fy ?? null,
    filing,
    distributions,
    assets: filingAssets ?? bmfAssets,
    assetsSource: filingAssets ? "filing" : bmfAssets ? "bmf" : null,
    grantsOnFile: toInt(row.grants_n),
    grantsTotal: positive(row.grants_total),
    grantsLastFy: row.grants_last_fy ?? null,
    sourceLabel: filing ? filingSourceLabel(filing.returnType, filing.fy) : IRS_MASTER_FILE_LABEL,
    match: { kind: ran, reason: reasonFor(ran, p, row), snippet: row.snippet, givingTo: givingToOf(row) },
    snapshot: {
      orgId: row.id,
      name: row.name,
      ein: row.ein ? row.ein.trim() : null,
      orgType: row.org_type,
      city: row.city,
      state: row.state,
      website: row.website,
    },
  };
}

export function emptyResult(params: SearchParams, extra: Partial<SearchResult> = {}): SearchResult {
  return {
    params,
    hits: [],
    page: params.page,
    pageSize: PAGE_SIZE,
    total: 0,
    poolLimit: 0,
    truncated: false,
    ran: null,
    notices: [],
    ...extra,
  };
}

/**
 * When `searchFunders` threw because Postgres stopped the statement at the
 * timeout (SQLSTATE 57014: a very common name over a cold cache), the honest
 * answer is an empty page with a `timed_out` notice, not an error page. Null
 * for every other error, which the caller rethrows. The JSON routes keep
 * answering 504 instead; this is for the rendered page.
 */
export function timedOutResult(err: unknown, params: SearchParams): SearchResult | null {
  return DbError.is(DbError.from(err), "timeout") ? emptyResult(params, { notices: ["timed_out"] }) : null;
}

export async function searchFunders(params: SearchParams, deps: SearchDeps = {}): Promise<SearchResult> {
  const run = deps.run ?? corpusQuery;
  const embed = deps.embed ?? embedQuery;

  const wantsVector = Boolean(params.q && !params.ein && params.mode === "thesis");
  const vec = wantsVector && params.q ? await embed(params.q) : null;

  const built = buildSearchSql(params, { vec });
  if (built.text === null) return emptyResult(params, { notices: built.notices });

  const rows = await run((sql) => sql.unsafe<Row[]>(built.text, built.values as never[]));
  const total = rows[0]?.total ?? 0;
  const poolSize = rows[0]?.pool_size ?? 0;
  const notices = [...built.notices];
  const truncated = poolSize >= built.poolLimit;
  if (truncated) notices.push("pool_bounded");

  return {
    params,
    hits: rows.map((row) => rowToHit(row, built.ran, params)),
    page: params.page,
    pageSize: PAGE_SIZE,
    total,
    poolLimit: built.poolLimit,
    truncated,
    ran: built.ran,
    notices,
  };
}

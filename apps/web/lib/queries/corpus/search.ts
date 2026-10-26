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
import { embedText, resolveContext, type ProfileContext, type SearcherContext } from "@/lib/search/context";
import { embedQuery } from "@/lib/search/embed";
import { PAGE_SIZE, nameQuery, type SearchParams } from "@/lib/search/params";
import { buildSearchSql, likeContains, normalizeName, type RanMode } from "@/lib/search/sql";
import { understand, type Understanding } from "@/lib/search/understand";

import { givingProfilesReady } from "./giving-profile";
import { positive, toInt } from "./safe";
import { canReadIrsStanding, readStandingsByOrg } from "./standing";
import type { IrsStanding } from "./standing-types";
import type { GivingToEvidence, NamedFunder, SearchFit, SearchHit, SearchResult } from "./types";

export type SearchDeps = {
  /** Runs `fn` against a SQL handle. Defaults to corpusQuery. Tests pass a fake. */
  run?: <T>(fn: (sql: postgres.TransactionSql) => Promise<T>, opts?: { timeoutMs?: number }) => Promise<T>;
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
  fit?: unknown;
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

/** The pool's fit object, kept only when it has the shape SearchFit promises. */
export function fitOf(raw: unknown): SearchFit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.tier !== "profiles" && r.tier !== "summary") return null;
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Math.round(Number(v)) : undefined);
  const fit: SearchFit = { tier: r.tier };
  if (typeof r.state === "string") fit.state = r.state;
  if (typeof r.located === "boolean") fit.located = r.located;
  if (Array.isArray(r.topStates)) fit.topStates = r.topStates.filter((x): x is string => typeof x === "string").slice(0, 5);
  if (typeof r.cause === "string") fit.cause = r.cause;
  if (typeof r.causeMentioned === "boolean") fit.causeMentioned = r.causeMentioned;
  for (const k of ["inState5y", "cause5y", "grants5y", "median5y", "windowFirstFy", "windowLastFy", "lastFy"] as const) {
    const v = int(r[k]);
    if (v !== undefined) fit[k] = v;
  }
  return fit;
}

function givingToOf(row: Row): GivingToEvidence | null {
  if (row.hit_n === undefined || row.hit_n === null || row.hit_n <= 0) return null;
  return {
    n: row.hit_n,
    total: positive(row.hit_total ?? null),
    samples: (row.hit_samples ?? []).filter((s): s is string => typeof s === "string" && s.trim().length > 0),
  };
}

export function rowToHit(row: Row, ran: RanMode, p: SearchParams, irsStanding: IrsStanding | null = null): SearchHit {
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
    irsStanding,
    match: { kind: ran, reason: reasonFor(ran, p, row), snippet: row.snippet, givingTo: givingToOf(row) },
    fit: fitOf(row.fit),
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

/**
 * How long a describe-the-work search may run before the answer falls back to
 * keywords. The index walk takes about a second; this only catches a cold or
 * overloaded database, and leaves the keyword query its own full timeout.
 */
export const SEMANTIC_TIMEOUT_MS = 8_000;

const msSince = (start: number): number => Math.round(performance.now() - start);

/**
 * The latest fiscal year most funders have reached. Grants before
 * maxFy - STALE_AFTER_YEARS count as "not recently giving" (lib/search/rank.ts);
 * returns lag a year or more, so the year before the current one.
 */
export function corpusMaxFy(now: Date = new Date()): number {
  return now.getUTCFullYear() - 1;
}

export type SearchOptions = {
  /** The signed-in workspace's profile, for ranking only (lib/search/context.ts). */
  profile?: ProfileContext | null;
};

type Build = { vec: number[] | null; understanding: Understanding; context: SearcherContext; maxFy: number };

function hasContext(c: SearcherContext): boolean {
  return Boolean(c.state || c.cause || c.budget);
}

export async function searchFunders(params: SearchParams, deps: SearchDeps = {}, opts: SearchOptions = {}): Promise<SearchResult> {
  const run = deps.run ?? corpusQuery;
  const embed = deps.embed ?? embedQuery;
  const started = performance.now();

  const understanding = understand(params.q);
  const context = resolveContext(params, understanding, opts.profile ?? null);
  const wantsVector = Boolean(params.q && !params.ein && params.mode === "thesis");
  // The searcher's cause and place ride along in the embedded text, so the
  // index walk starts near the funders that fit them (lib/search/context.ts).
  const vec = wantsVector && params.q ? await embed(embedText(params.q, understanding, context)) : null;
  const embedMs = wantsVector ? msSince(started) : null;

  // Pure first pass: it tells us whether a query runs at all (a name that is
  // too short does not), before any connection is opened.
  const build: Build = { vec, understanding, context, maxFy: corpusMaxFy() };
  const first = buildSearchSql(params, build);
  if (first.text === null) return emptyResult(params, { notices: first.notices });
  const dbStarted = performance.now();
  const timed = (result: SearchResult): SearchResult => ({
    ...result,
    timing: { embedMs, dbMs: msSince(dbStarted), totalMs: msSince(started) },
    context: hasContext(context) ? context : null,
  });
  if (first.ran !== "semantic") return timed(await runSearch(params, build, run));

  try {
    return timed(await runSearch(params, build, run, { timeoutMs: SEMANTIC_TIMEOUT_MS }));
  } catch (err) {
    // A slow meaning-based search is answered with keywords and a notice,
    // never an error page. Every other failure still propagates.
    if (!DbError.is(DbError.from(err), "timeout")) throw err;
    console.warn("[search] describe-the-work search timed out; answering with keywords");
    const result = await runSearch(params, { ...build, vec: null }, run);
    return timed({ ...result, notices: ["semantic_timed_out", ...result.notices.filter((n) => n !== "semantic_unavailable")] });
  }
}

/** Grantmakers whose own name matches a short topic query, for the "Funders named ..." line. */
async function namedFunders(sql: postgres.TransactionSql, q: string): Promise<NamedFunder[]> {
  const rows = await sql.unsafe<{ id: string; name: string; city: string | null; state: string | null }[]>(
    `select o.id::text as id, o.name, o.city, o.state
     from internal.organizations o
     where o.canonical_org_id is null
       and (o.name ilike $1::text or o.name_normalized like $2::text)
       and similarity(o.name, $3::text) >= 0.45
       and exists (select 1 from internal.search_documents sd
                   where sd.org_id = o.id and sd.program_id is null and sd.doc_kind = 'foundation')
     order by similarity(o.name, $3::text) desc, o.id
     limit 3`,
    [likeContains(q), likeContains(normalizeName(q)), q] as never[],
  );
  return rows.map((r) => ({ orgId: r.id, name: r.name, city: r.city, state: r.state }));
}

async function runSearch(params: SearchParams, build: Build, run: NonNullable<SearchDeps["run"]>, opts?: { timeoutMs?: number }): Promise<SearchResult> {
  const { built, rows, standings, profilesReady, named } = await run(async (sql) => {
    // The IRS standing view is readable only after corpus 0028 and web 0013;
    // the giving profiles only after corpus 0040, web 0018 and a refresh. The
    // probes cannot raise, and a "yes" is remembered for the process.
    const standingReadable = await canReadIrsStanding(sql);
    const profilesReady = await givingProfilesReady(sql);
    const built = buildSearchSql(params, { ...build, standingReadable, profilesReady });
    if (built.text === null) throw new Error("search: a query that built once no longer builds");
    if (built.ran === "semantic") {
      // The meaning leg walks the HNSW index with no filter; an iterative scan
      // lets that walk return every candidate the leg asks for.
      await sql.unsafe("set local hnsw.ef_search = 100");
      await sql.unsafe("set local hnsw.iterative_scan = relaxed_order");
    }
    const rows = await sql.unsafe<Row[]>(built.text, built.values as never[]);
    // One more small read for the rows on this page, so a card can say when
    // the IRS automatically revoked an organization. Under a savepoint: if it
    // fails, the search result still stands and the cards carry no chip.
    let standings: Record<string, IrsStanding> = {};
    if (standingReadable && rows.length > 0) {
      try {
        standings = (await sql.savepoint((s) => readStandingsByOrg(s, rows.map((row) => row.id)))) as Record<string, IrsStanding>;
      } catch (err) {
        console.warn("[corpus] irs standing for search results unavailable:", err instanceof Error ? err.message : err);
      }
    }
    // A short topic ("literacy", "Kresge") may also be a funder's name: offer
    // the matching grantmakers above the results. Optional, so a savepoint.
    let named: NamedFunder[] = [];
    const words = (params.q ?? "").trim().split(/\s+/).filter(Boolean);
    if ((built.ran === "semantic" || built.ran === "keyword") && params.page === 1 && words.length > 0 && words.length <= 3) {
      try {
        named = (await sql.savepoint((s) => namedFunders(s, (params.q ?? "").trim()))) as NamedFunder[];
      } catch (err) {
        console.warn("[corpus] named-funder probe unavailable:", err instanceof Error ? err.message : err);
      }
    }
    return { built, rows, standings, profilesReady, named };
  }, opts);
  const total = rows[0]?.total ?? 0;
  const poolSize = rows[0]?.pool_size ?? 0;
  const notices = [...built.notices];
  const truncated = poolSize >= built.poolLimit;
  // A topic search ranks a fixed number of the best candidates every time;
  // saying "more matched than we can rank" on each one would be noise.
  if (truncated && built.ran !== "semantic" && built.ran !== "keyword") notices.push("pool_bounded");

  return {
    params,
    hits: rows.map((row) => rowToHit(row, built.ran, params, standings[row.id] ?? null)),
    page: params.page,
    pageSize: PAGE_SIZE,
    total,
    poolLimit: built.poolLimit,
    truncated,
    ran: built.ran,
    notices,
    named: named.length ? named : undefined,
    givingProfiles: profilesReady,
  };
}

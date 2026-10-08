/**
 * The search SQL builder. Pure: it turns `SearchParams` into one statement
 * with positional parameters and never touches a pool, so its shape is unit
 * tested without a database (tests/unit/search/sql.test.ts).
 *
 * Every search is a bounded CANDIDATE POOL plus one projection:
 *
 *   with pool as (<mode-specific candidates: org_id, rank, snippet>)
 *   select <funder columns> from pool join organizations ... order by <sort> limit/offset
 *
 * Why a pool: 2.3M organizations cannot be ranked by similarity or relevance
 * on every page view, and the honest alternative to "page 37 of 12,000" is
 * "the top 400 matches, and here is how to narrow them". The pool size is
 * reported back so the page can say so.
 *
 * Modes:
 *   ein       exact identifier probe (public.org_identifiers)
 *   name      substring on internal.organizations.name via the trigram index,
 *             ranked by similarity with a prefix boost (covers public charities)
 *   keyword   full-text over organizations.search_tsv (names, places) and
 *             search_documents.search_tsv (giving summaries), merged by rank
 *   semantic  internal.hybrid_search (vector + FTS, RRF) with a Voyage query
 *             embedding; posture and distribution floors go INSIDE the function
 *   browse    no query text: filters only, ordered by the chosen sort
 *
 * Doctrine carried over from the sibling explorers:
 *   - canonical_org_id is null on every path (merge losers never list)
 *   - posture / distribution predicates go inside hybrid_search, never after
 *   - every money comparison casts the parameter explicitly
 *   - the IRS standing filter goes in the OUTER where, never inside a pool
 *     (lib/search/standing-filter.ts says why), and only when the caller has
 *     checked that the standing view can be read
 */
import {
  MAX_PAGE,
  MIN_NAME_CHARS,
  PAGE_SIZE,
  nameQuery,
  type SearchParams,
  type SearchPosture,
  type SearchSort,
  type SearchType,
} from "./params";
import { excludeRevokedSql } from "./standing-filter";

export const POOL_LIMIT = 400;
export const SEMANTIC_POOL_LIMIT = 200;
export const KEYWORD_LEG_LIMIT = 200;
export const EIN_POOL_LIMIT = 50;

export type RanMode = "ein" | "name" | "keyword" | "semantic" | "browse";

export type SearchNotice =
  | "semantic_unavailable"
  | "name_too_short"
  | "pool_bounded"
  | "posture_filter"
  | "giving_to_pool"
  | "rate_limited"
  /** The database stopped the query at the statement timeout (a very common name on a cold cache). */
  | "timed_out"
  /** Organizations the IRS automatically revoked were left out, because the reader asked for that. */
  | "standing_filter"
  /** The reader asked to leave them out, but the IRS lists cannot be read right now, so nothing was hidden. */
  | "standing_unavailable";

export type BuiltSearch = {
  text: string;
  values: unknown[];
  ran: RanMode;
  poolLimit: number;
  notices: SearchNotice[];
};

export type SkippedSearch = { text: null; ran: null; notices: SearchNotice[] };

/** Funder types a nonprofit searches. Investor types (fund, adviser) are out of scope. */
export const FUNDER_TYPES = ["private_foundation", "public_charity", "company", "gov_agency"] as const;

export function orgTypesFor(type: SearchType): string[] {
  return type === "all" ? [...FUNDER_TYPES] : [type];
}

/** UI value → value stored in mv_org_application_posture / search_documents.app_posture. */
export const POSTURE_DB: Record<SearchPosture, string> = {
  open: "open",
  preselected: "preselected_only",
  unknown: "unknown",
};

/** doc_kind values in search_documents for the chosen type. */
export function docKindsFor(type: SearchType): string[] {
  switch (type) {
    case "company":
      return ["company"];
    case "gov_agency":
      return ["program"];
    case "all":
      return ["foundation", "company"];
    default:
      return ["foundation"];
  }
}

/**
 * The spellings a name query must match. IRS master-file names drop the
 * apostrophe ("CHILDRENS HOSPITAL") while e-filed names keep it ("Children'S
 * Hospital"), so a query typed with one (straight or curly) also matches the
 * apostrophe-less spelling. Both patterns use the trigram index on `name`.
 */
export function nameVariants(name: string): string[] {
  const stripped = name.replace(/['\u2019]/g, "");
  return stripped !== name && stripped.trim().length >= MIN_NAME_CHARS ? [name, stripped] : [name];
}

/** Escape LIKE metacharacters (backslash is the default escape). */
export function likeContains(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function likePrefix(s: string): string {
  return `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Multi-word "giving to" input is almost always the NAME OF A KIND OF GRANTEE
 * ("food bank", "community college"), so a phrase is the honest default:
 * websearch_to_tsquery would otherwise AND the words anywhere in the row.
 * Explicit operators (quotes, OR, -word) are left alone.
 */
export function phraseQuery(input: string): string {
  const t = input.trim();
  const hasOperators = /["]|(^|\s)OR(\s|$)|(^|\s)-\S/.test(t);
  if (hasOperators || !/\s/.test(t)) return t;
  return `"${t}"`;
}

/** pgvector / halfvec text literal. */
export function vecLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/* -------------------------------------------------------------- internals */

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

const GIVING = "coalesce(fin.qualifying_distributions, fin.charitable_disbursements)";
const ASSETS = "coalesce(fin.total_assets_eoy, o.asset_amount)";

type FilterBits = { where: string[]; needAp: boolean; needFin: boolean };

/** Structured filters as predicates on aliases o / ap / fin. */
function orgFilters(p: SearchParams, ps: Params, opts: { types?: boolean } = {}): FilterBits {
  const where: string[] = ["o.canonical_org_id is null"];
  let needAp = false;
  let needFin = false;
  if (opts.types !== false) where.push(`o.org_type = any(${ps.add(orgTypesFor(p.type))}::text[])`);
  if (p.state) where.push(`o.state = ${ps.add(p.state)}::text`);
  if (p.ntee) where.push(`o.ntee_code like ${ps.add(likePrefix(p.ntee))}::text`);
  if (p.posture) {
    needAp = true;
    where.push(`ap.application_posture = ${ps.add(POSTURE_DB[p.posture])}::text`);
  }
  if (p.minDistributions) {
    needFin = true;
    where.push(`${GIVING} >= ${ps.add(p.minDistributions)}::numeric`);
  }
  if (p.minAssets) {
    needFin = true;
    where.push(`${ASSETS} >= ${ps.add(p.minAssets)}::numeric`);
  }
  return { where, needAp, needFin };
}

function joins(bits: { needAp: boolean; needFin: boolean }): string {
  return (
    (bits.needAp ? " left join internal.mv_org_application_posture ap on ap.org_id = o.id" : "") +
    (bits.needFin ? " left join internal.mv_org_latest_financials fin on fin.org_id = o.id" : "")
  );
}

function poolOrder(sort: SearchSort): string {
  switch (sort) {
    case "assets":
      return `${ASSETS} desc nulls last, o.name_normalized asc, o.id asc`;
    case "name":
      return "o.name_normalized asc, o.id asc";
    default:
      return `${GIVING} desc nulls last, o.name_normalized asc, o.id asc`;
  }
}

function outerOrder(sort: SearchSort, ran: RanMode, givingTo: boolean): string {
  const name = "o.name_normalized asc, o.id asc";
  const giving = `${GIVING} desc nulls last`;
  switch (sort) {
    case "distributions":
      return `${giving}, ${name}`;
    case "assets":
      return `${ASSETS} desc nulls last, ${name}`;
    case "name":
      return name;
    default:
      if (givingTo) return `gt.hit_total desc nulls last, p.rank desc nulls last, ${name}`;
      if (ran === "browse") return `${giving}, ${name}`;
      return `p.rank desc nulls last, ${giving}, ${name}`;
  }
}

/* ------------------------------------------------------------------ pools */

function einPool(ein: string, ps: Params): string {
  return `select o.id as org_id, 1::float8 as rank, null::text as snippet
    from internal.organizations o
    where o.canonical_org_id is null
      and o.id in (select oi.org_id from public.org_identifiers oi
                   where oi.id_type = 'ein' and oi.id_value = ${ps.add(ein)}::text)
    limit ${EIN_POOL_LIMIT}`;
}

function namePool(name: string, p: SearchParams, ps: Params): string {
  const q = ps.add(name);
  const variants = nameVariants(name);
  const contains = variants.map((v) => `o.name ilike ${ps.add(likeContains(v))}::text`).join(" or ");
  const prefix = variants.map((v) => `upper(o.name) like ${ps.add(likePrefix(v.toUpperCase()))}::text`).join(" or ");
  const bits = orgFilters(p, ps);
  return `select o.id as org_id,
           ((case when ${prefix} then 1 else 0 end) + similarity(o.name, ${q}::text))::float8 as rank,
           null::text as snippet
    from internal.organizations o${joins(bits)}
    where (${contains})
      and ${bits.where.join("\n      and ")}
    order by rank desc, o.name_normalized asc
    limit ${POOL_LIMIT}`;
}

function keywordPool(q: string, p: SearchParams, ps: Params): string {
  const qp = ps.add(q);
  const orgBits = orgFilters(p, ps);
  const sdBits = orgFilters(p, ps);
  const kinds = ps.add(docKindsFor(p.type));
  return `select org_id, sum(1.0 / (60 + rn))::float8 as rank, max(snippet) as snippet
    from (
      (select o.id as org_id, null::text as snippet,
              row_number() over (order by ts_rank_cd(o.search_tsv, query) desc, o.id) as rn
       from internal.organizations o${joins(orgBits)},
            websearch_to_tsquery('english', ${qp}::text) query
       where o.search_tsv @@ query
         and ${orgBits.where.join("\n         and ")}
       order by ts_rank_cd(o.search_tsv, query) desc, o.id
       limit ${KEYWORD_LEG_LIMIT})
      union all
      (select sd.org_id, left(sd.doc_text, 240) as snippet,
              row_number() over (order by ts_rank_cd(sd.search_tsv, query) desc, sd.id) as rn
       from internal.search_documents sd
       join internal.organizations o on o.id = sd.org_id${joins(sdBits)},
            websearch_to_tsquery('english', ${qp}::text) query
       where sd.search_tsv @@ query
         and sd.program_id is null
         and sd.doc_kind = any(${kinds}::text[])
         and ${sdBits.where.join("\n         and ")}
       order by ts_rank_cd(sd.search_tsv, query) desc, sd.id
       limit ${KEYWORD_LEG_LIMIT})
    ) legs
    group by org_id`;
}

function semanticPool(q: string, vec: number[], p: SearchParams, ps: Params): string {
  const qp = ps.add(q);
  const v = ps.add(vecLiteral(vec));
  const kinds = ps.add(docKindsFor(p.type));
  const types = ps.add(orgTypesFor(p.type));
  const state = ps.add(p.state);
  const minAssets = ps.add(p.minAssets);
  const postures = ps.add(p.posture ? [POSTURE_DB[p.posture]] : null);
  const minDist = ps.add(p.minDistributions);
  return `select h.org_id, h.rrf::float8 as rank, h.snippet
    from internal.hybrid_search(
           ${qp}::text,
           ${v}::extensions.halfvec(512),
           ${SEMANTIC_POOL_LIMIT},
           ${kinds}::text[],
           ${types}::text[],
           ${state}::text,
           ${minAssets}::numeric,
           ${postures}::text[],
           ${minDist}::numeric) h
    where h.org_id is not null`;
}

function browsePool(p: SearchParams, ps: Params): string {
  const bits = orgFilters(p, ps);
  const sortsByGiving = p.sort === "relevance" || p.sort === "distributions";
  // Ranking by giving: drive from the (smaller) financials view; orgs without
  // a parsed return sort last anyway and the pool is bounded, so nothing that
  // could reach the page is lost. Other sorts keep every organization.
  const from = sortsByGiving
    ? `internal.mv_org_latest_financials fin join internal.organizations o on o.id = fin.org_id${
        bits.needAp ? " left join internal.mv_org_application_posture ap on ap.org_id = o.id" : ""
      }`
    : `internal.organizations o${joins({ needAp: bits.needAp, needFin: bits.needFin || p.sort === "assets" })}`;
  return `select o.id as org_id, 0::float8 as rank, null::text as snippet
    from ${from}
    where ${bits.where.join("\n      and ")}
    order by ${poolOrder(p.sort)}
    limit ${POOL_LIMIT}`;
}

/* ------------------------------------------------------------- the build */

export function buildSearchSql(
  p: SearchParams,
  opts: {
    vec?: number[] | null;
    /**
     * True when this connection may read internal.org_irs_standing
     * (lib/queries/corpus/standing.ts canReadIrsStanding). Without it the
     * standing filter is left out, and a notice says that nothing was hidden.
     */
    standingReadable?: boolean;
  } = {},
): BuiltSearch | SkippedSearch {
  const ps = new Params();
  const notices: SearchNotice[] = [];
  let ran: RanMode;
  let pool: string;
  let poolLimit: number;
  let postNtee = false;

  if (p.ein) {
    ran = "ein";
    pool = einPool(p.ein, ps);
    poolLimit = EIN_POOL_LIMIT;
  } else if (p.q && p.mode === "name") {
    const name = nameQuery(p) ?? p.q;
    if (name.length < MIN_NAME_CHARS) return { text: null, ran: null, notices: ["name_too_short"] };
    ran = "name";
    pool = namePool(name, p, ps);
    poolLimit = POOL_LIMIT;
  } else if (p.q && p.mode === "thesis" && opts.vec && opts.vec.length > 0) {
    ran = "semantic";
    pool = semanticPool(p.q, opts.vec, p, ps);
    poolLimit = SEMANTIC_POOL_LIMIT;
    postNtee = Boolean(p.ntee);
  } else if (p.q) {
    if (p.mode === "thesis") notices.push("semantic_unavailable");
    ran = "keyword";
    pool = keywordPool(p.q, p, ps);
    poolLimit = KEYWORD_LEG_LIMIT * 2;
  } else {
    ran = "browse";
    pool = browsePool(p, ps);
    poolLimit = POOL_LIMIT;
  }

  if (p.posture) notices.push("posture_filter");
  if (p.givingTo) notices.push("giving_to_pool");

  const page = Math.min(Math.max(1, p.page), MAX_PAGE);
  const limit = ps.add(PAGE_SIZE);
  const offset = ps.add((page - 1) * PAGE_SIZE);

  const where: string[] = [];
  if (postNtee && p.ntee) where.push(`o.ntee_code like ${ps.add(likePrefix(p.ntee))}::text`);
  if (p.standing === "hide_revoked") {
    if (opts.standingReadable) {
      where.push(excludeRevokedSql("o"));
      notices.push("standing_filter");
    } else {
      notices.push("standing_unavailable");
    }
  }

  let lateral = "";
  let hitCols = "";
  if (p.givingTo) {
    const gt = ps.add(phraseQuery(p.givingTo));
    lateral = `
    cross join lateral (
      select count(*)::int as hit_n,
             sum(e.amount)::numeric as hit_total,
             (array_agg(distinct e.recipient_name))[1:3] as hit_samples
      from internal.funding_events e
      where e.funder_org_id = o.id
        and e.event_type = 'grant'
        and e.search_tsv @@ websearch_to_tsquery('english', ${gt}::text)
    ) gt`;
    hitCols = `
       gt.hit_n, gt.hit_total::text as hit_total, gt.hit_samples,`;
    where.push("gt.hit_n > 0");
  }

  const text = `with pool as (
    ${pool}
  )
select o.id::text as id, o.name, o.org_type, o.city, o.state, o.ntee_code, o.focus_areas, o.website,
       o.asset_amount::text as bmf_assets,
       coalesce(fin.ein, ap.ein)::text as ein,
       ap.application_posture, ap.fy as posture_fy,
       fin.fy as fin_fy, fin.return_type as fin_return_type, fin.object_id as fin_object_id,
       fin.qualifying_distributions::text as qualifying_distributions,
       fin.charitable_disbursements::text as charitable_disbursements,
       fin.total_assets_eoy::text as total_assets_eoy,
       g.n::text as grants_n, g.total::text as grants_total, g.last_fy as grants_last_fy,
       p.rank::float8 as rank, p.snippet,${hitCols}
       count(*) over()::int as total,
       (select count(*) from pool)::int as pool_size
from pool p
join internal.organizations o on o.id = p.org_id
left join internal.mv_org_application_posture ap on ap.org_id = o.id
left join internal.mv_org_latest_financials fin on fin.org_id = o.id
left join internal.mv_funder_event_stats g on g.org_id = o.id and g.event_type = 'grant'${lateral}
${where.length ? `where ${where.join("\n  and ")}\n` : ""}order by ${outerOrder(p.sort, ran, Boolean(p.givingTo))}
limit ${limit}::int offset ${offset}::int`;

  return { text, values: ps.values, ran, poolLimit, notices };
}

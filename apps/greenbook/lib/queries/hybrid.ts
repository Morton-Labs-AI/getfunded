import type postgres from "postgres";
import { vecLiteral } from "@/lib/ai/embed";

/**
 * internal.hybrid_search with filters, without the exact scan that outruns
 * the statement timeout. Shared by /browse thesis mode and the analyst's
 * semantic_funder_search tool.
 *
 * Any filter argument sends hybrid_search to its exact branch (corpus 0011):
 * it ranks every vector the filters keep by exact distance. On the hosted
 * database that answers in 2-7 s cold for a small slice (one state, advisers,
 * companies, open-to-apply foundations) and outruns the 15 s timeout when the
 * filters keep most of the 257k documents (all foundations: 199k vectors,
 * more than fits in shared_buffers). So Postgres's own estimate of the rows
 * the filters keep picks the path (hybridPlan):
 *
 *   exact  at most EXACT_MAX_DOCS: the filters go inside hybrid_search, as before
 *   walk   more: hybrid_search with no filters, which walks the HNSW index
 *          (ef_search 60 and an iterative scan, set by the function), over
 *          WALK_CANDIDATES documents; the same predicates then run on the rows
 *          it returns
 *
 * The walk only serves filters that keep most documents, because the
 * embedding space clusters by doc_kind (0011): the 600 closest documents to a
 * foundation-like query are all foundations, so an adviser filter on them
 * keeps none. Measured 2026-10-26 (hosted database, 600 candidates): at
 * ef_search 100 the walk returns the same 600 documents as at 60.
 */

/** hybrid_search's filter arguments. Null leaves a filter off. */
export interface HybridFilters {
  kinds?: string[] | null;
  orgTypes?: string[] | null;
  state?: string | null;
  minSize?: number | null;
  postures?: string[] | null;
  minDistributions?: number | null;
}

export type HybridPlan = "unfiltered" | "exact" | "walk";

/** Filters that keep at most this many documents (Postgres's estimate) run inside hybrid_search. */
export const EXACT_MAX_DOCS = 25_000;
/** Documents the unfiltered walk returns before the filters run. */
export const WALK_CANDIDATES = 600;
/** Statement timeout for a semantic search; callers answer with keyword matches when it is hit. */
export const SEMANTIC_TIMEOUT_MS = 8_000;

/** True for Postgres's statement timeout (SQLSTATE 57014), by shape: minified bundles rename error classes. */
export function isStatementTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "57014";
}

function isFiltered(f: HybridFilters): boolean {
  return [f.kinds, f.orgTypes, f.state, f.minSize, f.postures, f.minDistributions].some((v) => v != null);
}

/**
 * The filters as predicates on the column names hybrid_search returns, which
 * are also search_documents' own. hybrid_search applies the same ones.
 */
function filterSql(tx: postgres.TransactionSql, f: HybridFilters) {
  return tx`
    ${f.kinds != null ? tx`and doc_kind = any(${f.kinds}::text[])` : tx``}
    ${f.orgTypes != null ? tx`and org_type = any(${f.orgTypes}::text[])` : tx``}
    ${f.state != null ? tx`and state = ${f.state}::text` : tx``}
    ${f.minSize != null ? tx`and size_amount >= ${f.minSize}::numeric` : tx``}
    ${f.postures != null ? tx`and app_posture = any(${f.postures}::text[])` : tx``}
    ${f.minDistributions != null ? tx`and annual_distributions >= ${f.minDistributions}::numeric` : tx``}`;
}

/** "Plan Rows" of the top node of EXPLAIN (FORMAT JSON) output; Infinity when unreadable. */
function planRows(plan: unknown): number {
  const parsed = typeof plan === "string" ? JSON.parse(plan) : plan;
  const rows = Number((parsed as { Plan?: { "Plan Rows"?: unknown } }[] | null)?.[0]?.Plan?.["Plan Rows"]);
  return Number.isFinite(rows) ? rows : Number.POSITIVE_INFINITY;
}

/** Which path a search with these filters takes. One planner call when there are filters, no scan. */
export async function hybridPlan(tx: postgres.TransactionSql, f: HybridFilters): Promise<HybridPlan> {
  if (!isFiltered(f)) return "unfiltered";
  const [row] = await tx<{ "QUERY PLAN": unknown }[]>`
    explain (format json)
    select 1 from internal.search_documents
    where embedding is not null ${filterSql(tx, f)}`;
  return planRows(row?.["QUERY PLAN"]) <= EXACT_MAX_DOCS ? "exact" : "walk";
}

/**
 * hybrid_search's rows for `q` as a FROM item with its columns, at most
 * `limit`. Order by (rrf desc, size_amount desc nulls last), as the function does.
 */
export function hybridSource(
  tx: postgres.TransactionSql,
  q: string,
  vec: number[],
  limit: number,
  f: HybridFilters,
  plan: HybridPlan
) {
  const v = vecLiteral(vec);
  if (plan === "unfiltered") {
    return tx`internal.hybrid_search(${q}, ${v}::extensions.halfvec(512), ${limit})`;
  }
  if (plan === "exact") {
    return tx`internal.hybrid_search(
      ${q},
      ${v}::extensions.halfvec(512),
      ${limit},
      ${f.kinds ?? null}::text[],
      ${f.orgTypes ?? null}::text[],
      ${f.state ?? null}::text,
      ${f.minSize ?? null}::numeric,
      ${f.postures ?? null}::text[],
      ${f.minDistributions ?? null}::numeric)`;
  }
  return tx`(
    select * from internal.hybrid_search(${q}, ${v}::extensions.halfvec(512), ${Math.max(limit, WALK_CANDIDATES)}) w
    where true ${filterSql(tx, f)}
    order by w.rrf desc, w.size_amount desc nulls last
    limit ${limit})`;
}

/**
 * The keyword answer when the semantic search timed out: hybrid_search's
 * keyword leg alone (full text over the same documents, the same filters),
 * in hybridSource's columns, with the rrf that leg would have given each row.
 */
export function keywordSource(tx: postgres.TransactionSql, q: string, limit: number, f: HybridFilters) {
  return tx`(
    select k.doc_id, k.org_id, k.program_id, k.doc_kind, coalesce(o.name, fp.name) as name,
           k.org_type, k.state, k.size_amount, null::int as vec_rank, k.fts_rank,
           (1.0 / (60 + k.fts_rank))::float4 as rrf, k.snippet, k.app_posture, k.annual_distributions
    from (
      select id as doc_id, org_id, program_id, doc_kind, org_type, state, size_amount,
             (row_number() over (order by ts_rank_cd(search_tsv, t.query) desc))::int as fts_rank,
             left(doc_text, 240) as snippet, app_posture, annual_distributions
      from internal.search_documents, websearch_to_tsquery('english', ${q}) t(query)
      where search_tsv @@ t.query ${filterSql(tx, f)}
      order by fts_rank
      limit ${limit}
    ) k
    left join internal.organizations o on o.id = k.org_id
    left join internal.funding_programs fp on fp.id = k.program_id)`;
}

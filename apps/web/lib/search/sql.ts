/**
 * The search SQL builder. Pure: it turns `SearchParams` into one statement
 * with positional parameters and never touches a pool, so its shape is unit
 * tested without a database (tests/unit/search/sql.test.ts).
 *
 * Every search is a bounded CANDIDATE POOL plus one projection:
 *
 *   with pool as (<mode-specific candidates: org_id, rank, snippet, fit>)
 *   select <funder columns> from pool join organizations ... order by <sort> limit/offset
 *
 * Why a pool: 2.3M organizations cannot be ranked by similarity or relevance
 * on every page view, and the honest alternative to "page 37 of 12,000" is
 * "the top 400 matches, and here is how to narrow them". The pool size is
 * reported back so the page can say so.
 *
 * Modes:
 *   ein       exact identifier probe (public.org_identifiers)
 *   name      a funder's own name: substring on the name (as filed and as the
 *             corpus normalizes it) via the trigram indexes, ranked by an exact
 *             or whole-phrase match, then similarity, then how much it gives
 *   semantic  a topic, the words embedded (Voyage): the topic pool below
 *   keyword   a topic, no embedding (semantic search off or down): the same
 *             pool without its meaning leg
 *   browse    no query text: filters only, ordered by the chosen sort; with
 *             "gives in" or "funds this cause" and the giving profiles loaded,
 *             the funders that gave most there
 *
 * The topic pool (topicPool) finds grantmakers, never just organizations whose
 * names contain the words. Its legs, merged by reciprocal rank (lib/search/rank.ts):
 *   meaning   the closest funder summaries to the embedding, by an HNSW index
 *             walk with no filter (any filter turns pgvector's walk into a
 *             scan that outruns the statement timeout on the hosted database)
 *   keywords  summaries containing every word of the topic
 *   in-state  summaries of funders based in the searcher's state that mention
 *             the topic (index on search_documents (state, doc_kind), corpus 0041)
 *   givers    with the giving profiles (corpus 0040): the funders that gave most
 *             in the "gives in" state or to the "funds this cause" group
 * The best LEG_LIMITS.features candidates then get features read from their
 * summaries and, when loaded, the giving profiles, and a fit score that prefers
 * funders giving where the searcher works and to work like theirs.
 *
 * Doctrine carried over from the sibling explorers:
 *   - canonical_org_id is null on every path (merge losers never list)
 *   - every money comparison casts the parameter explicitly
 *   - the IRS standing filter goes in the OUTER where, never inside a pool
 *     (lib/search/standing-filter.ts says why), and only when the caller has
 *     checked that the standing view can be read
 *   - a search reads the giving profiles only when the caller has checked they
 *     are readable and filled (lib/queries/corpus/giving-profile.ts)
 */
import { CAUSE_WORDS, EMPTY_CONTEXT, type SearcherContext } from "./context";
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
import { CAUSE_FULL_SHARE, GEO_FULL_AT, LEG_LIMITS, RANK_WEIGHTS, STALE_AFTER_YEARS, type RankWeights } from "./rank";
import { excludeRevokedSql } from "./standing-filter";
import { contentWords, understand, type Understanding } from "./understand";

export const POOL_LIMIT = 400;
/** Candidates a topic search ranks in full (the merged legs' best). */
export const SEMANTIC_POOL_LIMIT = LEG_LIMITS.features;
/** Funder summaries the meaning leg reads from the HNSW index. */
export const SEMANTIC_CANDIDATES = LEG_LIMITS.meaning;
export const KEYWORD_LEG_LIMIT = LEG_LIMITS.keywords;
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
  /** The meaning-based search ran out of time, so the page shows keyword matches instead. */
  | "semantic_timed_out"
  /** A topic search with filters: the filters ran over the best-matching candidates. */
  | "semantic_filtered"
  /** The words read like a funder's name but no funder has it, so they were searched as a topic. */
  | "name_no_match"
  /** "Gives in" or "funds this cause" was asked, but the giving profiles are not loaded yet, so it was not applied. */
  | "giving_profiles_unavailable"
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

export type BuildOptions = {
  vec?: number[] | null;
  /**
   * True when this connection may read internal.org_irs_standing
   * (lib/queries/corpus/standing.ts canReadIrsStanding). Without it the
   * standing filter is left out, and a notice says that nothing was hidden.
   */
  standingReadable?: boolean;
  /** What the words mean (lib/search/understand.ts). Computed from `q` when absent. */
  understanding?: Understanding;
  /** Who is searching (lib/search/context.ts). */
  context?: SearcherContext;
  /** The corpus 0040 giving profiles are readable and filled. */
  profilesReady?: boolean;
  /** The latest fiscal year most funders have reached; grants before maxFy - STALE_AFTER_YEARS are "not recent". */
  maxFy?: number;
  weights?: RankWeights;
};

/** Funder types a nonprofit searches. Investor types (fund, adviser) are out of scope. */
export const FUNDER_TYPES = ["private_foundation", "public_charity", "company", "gov_agency"] as const;

export function orgTypesFor(type: SearchType): string[] {
  return type === "all" ? [...FUNDER_TYPES] : [type];
}

/**
 * Who a topic search returns for "all funder types": organizations with a
 * funder summary, which exists only for grantmakers with grants on file.
 * Companies (SBIR awardees, Form D issuers) are left out unless asked for by
 * type; they are not grantmakers.
 */
export function topicOrgTypes(type: SearchType): string[] {
  return type === "all" ? ["private_foundation", "public_charity"] : [type];
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

/** doc_kind values a topic search reads: grantmakers unless a type asks otherwise. */
export function topicDocKinds(type: SearchType): string[] {
  return type === "all" ? ["foundation"] : docKindsFor(type);
}

/**
 * The spellings a name query must match. IRS master-file names drop the
 * apostrophe ("CHILDRENS HOSPITAL") while e-filed names keep it ("Children'S
 * Hospital"), so a query typed with one (straight or curly) also matches the
 * apostrophe-less spelling. Both patterns use the trigram index on `name`.
 */
export function nameVariants(name: string): string[] {
  const stripped = name.replace(/['’]/g, "");
  return stripped !== name && stripped.trim().length >= MIN_NAME_CHARS ? [name, stripped] : [name];
}

/**
 * A name as the corpus normalizes it (internal.norm_name: upper case, any
 * character other than a letter, digit, space, "&" or "-" turned into a space,
 * spaces collapsed), so "Annie E. Casey" finds "ANNIE E CASEY FOUNDATION".
 * Computed here so the pattern reaches Postgres as a plain parameter the
 * trigram index on name_normalized can use.
 */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape LIKE metacharacters (backslash is the default escape). */
export function likeContains(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function likePrefix(s: string): string {
  return `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** A Postgres regular expression matching any of `words` as a whole word. */
export function wordsRegex(words: string[]): string {
  const alt = words.map((w) => w.toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean);
  return `\\m(${alt.join("|")})\\M`;
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

/** True when a topic search carries a filter that narrows its candidates. */
export function semanticFiltered(p: SearchParams): boolean {
  return Boolean(p.state || p.minAssets || p.posture || p.minDistributions || p.ntee || p.type !== "all");
}

/* -------------------------------------------------------------- internals */

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

/** A weight from rank.ts as an SQL literal. Weights are code constants, never input. */
function num(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`rank weight must be finite, got ${x}`);
  return x.toFixed(4);
}

const GIVING = "coalesce(fin.qualifying_distributions, fin.charitable_disbursements)";
const ASSETS = "coalesce(fin.total_assets_eoy, o.asset_amount)";

type FilterBits = { where: string[]; needAp: boolean; needFin: boolean };

/** Structured filters as predicates on aliases o / ap / fin. */
function orgFilters(p: SearchParams, ps: Params, opts: { types?: boolean; profiles?: boolean } = {}): FilterBits {
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
  if (opts.profiles && p.givesIn) {
    where.push(`exists (select 1 from internal.mv_funder_giving_state gsf
                        where gsf.funder_org_id = o.id and gsf.state = ${ps.add(p.givesIn)}::text and gsf.n_grants_5y > 0)`);
  }
  if (opts.profiles && p.cause) {
    where.push(`exists (select 1 from internal.mv_funder_giving_cause gcf
                        where gcf.funder_org_id = o.id and gcf.ntee_major = ${ps.add(p.cause)}::text and gcf.n_grants_5y >= 2)`);
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

function outerOrder(sort: SearchSort, ran: RanMode, givingTo: boolean, rankedBrowse: boolean): string {
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
      if (ran === "browse" && !rankedBrowse) return `${giving}, ${name}`;
      return `p.rank desc nulls last, ${giving}, ${name}`;
  }
}

/* ------------------------------------------------------------------ pools */

function einPool(ein: string, ps: Params): string {
  return `select o.id as org_id, 1::float8 as rank, null::text as snippet, null::jsonb as fit
    from internal.organizations o
    where o.canonical_org_id is null
      and o.id in (select oi.org_id from public.org_identifiers oi
                   where oi.id_type = 'ein' and oi.id_value = ${ps.add(ein)}::text)
    limit ${EIN_POOL_LIMIT}`;
}

/** Words too common in funder names to narrow a name search through the trigram index. */
const GENERIC_NAME_TOKENS = new Set([
  "THE", "OF", "AND", "FOR", "FOUNDATION", "FOUNDATIONS", "FUND", "FUNDS", "TRUST", "INC", "INCORPORATED", "CORP",
  "CORPORATION", "CHARITABLE", "FAMILY", "COMMUNITY", "ENDOWMENT", "ASSOCIATION", "SOCIETY", "INSTITUTE", "GIVING",
  "LLC", "LTD", "CO",
]);

/**
 * A trigram-indexable regular expression for a word that STARTS with `token`
 * ("\mford" finds FORD and FORDHAM, not STANFORD; "\mchildren" also finds
 * CHILDRENS). Far fewer candidates than a substring match on a short token.
 */
export function wordStart(token: string): string {
  return `\\m${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
}

/**
 * The words that make a name distinctive ("MOORE" in "Moore Foundation"),
 * longest first, at most three. A trigram match on "%foundation%" touches
 * hundreds of thousands of names; one on "%moore%" a thousand.
 */
export function nameTokens(normalized: string): string[] {
  return [...new Set(normalized.split(" ").filter((t) => t.length >= 3 && !GENERIC_NAME_TOKENS.has(t)))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
}

/**
 * A funder's own name. Candidates come through the trigram index on the
 * distinctive words, then must contain the whole name as the corpus
 * normalizes it (so "Annie E. Casey" finds "ANNIE E CASEY FOUNDATION").
 * Ranked: the exact name, the name as a whole phrase, a prefix, trigram
 * similarity, and how much the funder gives ("Moore Foundation" means the
 * large one far more often than the small ones sharing the words).
 */
function namePool(name: string, p: SearchParams, ps: Params, profiles: boolean): string {
  const q = ps.add(name);
  const variants = nameVariants(name);
  const norms = [...new Set(variants.map(normalizeName))].filter(Boolean);
  const tokens = nameTokens(norms[0] ?? "");
  const narrow = tokens.length
    ? tokens.map((t) => `o.name ~* ${ps.add(wordStart(t))}::text`).join(" and ")
    : `(${variants.map((v) => `o.name ilike ${ps.add(likeContains(v))}::text`).join(" or ")})`;
  const whole = norms.map((n) => `strpos(o.name_normalized, ${ps.add(n)}::text) > 0`).join(" or ");
  const norm = norms[0] ?? normalizeName(name);
  const exact = `o.name_normalized = ${ps.add(norm)}::text`;
  const prefix = `o.name_normalized like ${ps.add(likePrefix(norm))}::text`;
  const phrase = `o.name_normalized ~ ${ps.add(`\\m${norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\M`)}::text`;
  const bits = orgFilters(p, ps, { profiles });
  return `select o.id as org_id,
           ((case when ${exact} then 1.5 else 0 end)
            + (case when ${phrase} then 1 else 0 end)
            + (case when ${prefix} then 0.5 else 0 end)
            + similarity(o.name, ${q}::text)
            + 0.35 * log(1 + greatest(coalesce(${GIVING}, 0), coalesce(o.asset_amount, 0) * 0.05, 0)::numeric))::float8 as rank,
           null::text as snippet,
           null::jsonb as fit
    from internal.organizations o${joins({ ...bits, needFin: true })}
    where ${narrow}
      and (${whole})
      and ${bits.where.join("\n      and ")}
    order by rank desc, o.name_normalized asc, o.id asc
    limit ${POOL_LIMIT}`;
}

type TopicOptions = { profiles: boolean; maxFy: number; w: RankWeights };

/**
 * The topic pool: funders whose giving matches the words, ranked by fit for
 * the searcher (see the header and lib/search/rank.ts). Every leg returns
 * search_documents ids in its own order; the arrays keep that order
 * (`with ordinality`), so no leg re-reads an embedding or a full summary.
 */
function topicPool(p: SearchParams, vec: number[] | null, u: Understanding, ctx: SearcherContext, ps: Params, o: TopicOptions): { sql: string; notices: SearchNotice[] } {
  const notices: SearchNotice[] = [];
  const w = o.w;
  const kinds = ps.add(topicDocKinds(p.type));
  const types = ps.add(topicOrgTypes(p.type));
  const topic = u.topic || p.q || "";
  const legs: string[] = [];

  if (vec) {
    const v = ps.add(vecLiteral(vec));
    legs.push(`select u.id, u.r, 1 as leg from unnest(array(
        select sd.id from internal.search_documents sd
        where sd.embedding is not null
        order by sd.embedding operator(extensions.<=>) ${v}::extensions.halfvec(512)
        limit ${LEG_LIMITS.meaning})) with ordinality as u(id, r)`);
  }

  if (topic) {
    const kq = ps.add(topic);
    // With a meaning leg the keyword leg only has to supply candidates: the
    // largest givers among the summaries holding every word. Without one it is
    // the ranking, so it orders by text rank.
    const order = vec ? "sd.annual_distributions desc nulls last, sd.id" : "ts_rank_cd(sd.search_tsv, websearch_to_tsquery('english', " + kq + "::text)) desc, sd.id";
    legs.push(`select u.id, u.r, 2 as leg from unnest(array(
        select sd.id from internal.search_documents sd
        where sd.search_tsv @@ websearch_to_tsquery('english', ${kq}::text)
          and sd.doc_kind = any(${kinds}::text[])
          and sd.program_id is null
        order by ${order}
        limit ${LEG_LIMITS.keywords})) with ordinality as u(id, r)`);
  }

  const st = ctx.state ? ps.add(ctx.state) : null;
  if (st) {
    let words = contentWords(topic);
    if (words.length === 0 && ctx.cause) words = CAUSE_WORDS[ctx.cause].words.slice(0, 6);
    const match = words.length ? `and sd.search_tsv @@ websearch_to_tsquery('english', ${ps.add(words.join(" OR "))}::text)` : "";
    legs.push(`select u.id, u.r, 3 as leg from unnest(array(
        select sd.id from internal.search_documents sd
        where sd.state = ${st}::text and sd.doc_kind = 'foundation' and sd.embedding is not null
          ${match}
        order by sd.annual_distributions desc nulls last, sd.id
        limit ${LEG_LIMITS.local})) with ordinality as u(id, r)`);
  }

  // Explicit "gives in" / "funds this cause": also draw candidates from the
  // giving profiles, so the filter has funders to keep.
  const givesIn = o.profiles && p.givesIn ? ps.add(p.givesIn) : null;
  const causeFilter = o.profiles && p.cause ? ps.add(p.cause) : null;
  if (givesIn) {
    legs.push(`select u.id, u.r, 4 as leg from unnest(array(
        select sd.id from internal.mv_funder_giving_state g
        join internal.search_documents sd on sd.org_id = g.funder_org_id and sd.program_id is null
        where g.state = ${givesIn}::text and g.n_grants_5y > 0 and sd.doc_kind = any(${kinds}::text[])
        order by g.n_grants_5y desc, sd.id
        limit 300)) with ordinality as u(id, r)`);
  } else if (causeFilter) {
    legs.push(`select u.id, u.r, 4 as leg from unnest(array(
        select sd.id from internal.mv_funder_giving_cause g
        join internal.search_documents sd on sd.org_id = g.funder_org_id and sd.program_id is null
        where g.ntee_major = ${causeFilter}::text and g.n_grants_5y >= 2 and sd.doc_kind = any(${kinds}::text[])
        order by g.n_grants_5y desc, sd.id
        limit 300)) with ordinality as u(id, r)`);
  }

  const filters: string[] = [];
  if (p.state) filters.push(`o.state = ${ps.add(p.state)}::text`);
  if (p.ntee) filters.push(`o.ntee_code like ${ps.add(likePrefix(p.ntee))}::text`);
  if (p.minAssets) filters.push(`sd.size_amount >= ${ps.add(p.minAssets)}::numeric`);
  if (p.posture) filters.push(`sd.app_posture = ${ps.add(POSTURE_DB[p.posture])}::text`);
  if (p.minDistributions) filters.push(`sd.annual_distributions >= ${ps.add(p.minDistributions)}::numeric`);
  if (filters.length || givesIn || causeFilter) notices.push("semantic_filtered");

  const cause = ctx.cause ? ps.add(ctx.cause) : null;
  const causeRe = ctx.cause ? ps.add(wordsRegex(CAUSE_WORDS[ctx.cause].words)) : null;

  // Features for the best candidates.
  const profileCols = o.profiles
    ? `, ${st ? "gs.n_grants_5y" : "null::int"} as in_state_5y,
         ${cause ? "gc.n_grants_5y" : "null::int"} as cause_5y,
         gp.n_grants_5y as grants_5y, gp.median_paid_5y, gp.window_first_fy, gp.window_last_fy`
    : `, null::int as in_state_5y, null::int as cause_5y, null::int as grants_5y,
         null::numeric as median_paid_5y, null::smallint as window_first_fy, null::smallint as window_last_fy`;
  const profileJoins = o.profiles
    ? `${st ? `\n      left join internal.mv_funder_giving_state gs on gs.funder_org_id = s.org_id and gs.state = ${st}::text` : ""}${
        cause ? `\n      left join internal.mv_funder_giving_cause gc on gc.funder_org_id = s.org_id and gc.ntee_major = ${cause}::text` : ""
      }
      left join internal.mv_funder_grant_profile gp on gp.funder_org_id = s.org_id`
    : "";
  const filterJoins = [
    givesIn ? `join internal.mv_funder_giving_state gsf on gsf.funder_org_id = s.org_id and gsf.state = ${givesIn}::text and gsf.n_grants_5y > 0` : "",
    causeFilter ? `join internal.mv_funder_giving_cause gcf on gcf.funder_org_id = s.org_id and gcf.ntee_major = ${causeFilter}::text and gcf.n_grants_5y >= 2` : "",
  ]
    .filter(Boolean)
    .join("\n      ");

  // The fit score (lib/search/rank.ts): fit for the searcher (place, cause)
  // either adds to relevance or multiplies it; the rest always adds.
  const fit: string[] = [];
  if (st) {
    fit.push(
      o.profiles
        ? `(case when f.in_state_5y > 0 then ${num(w.geo)} * least(1.0, ln(1 + f.in_state_5y) / ln(${GEO_FULL_AT + 1})) else 0 end)`
        : `coalesce(${num(w.geo)} * (1.2 - 0.2 * array_position(f.top_states, ${st}::text)), 0)`,
      `(case when f.doc_state = ${st}::text then ${num(w.located)} else 0 end)`,
    );
  }
  if (cause) {
    fit.push(
      o.profiles
        ? `(case when f.cause_5y > 0 then ${num(w.cause)} * least(1.0, f.cause_5y::numeric / greatest(coalesce(f.grants_5y, 0) * ${num(CAUSE_FULL_SHARE)}, 3)) else 0 end)`
        : `(case when f.cause_hit then ${num(w.cause * 0.6)} else 0 end)`,
    );
  }
  const parts: string[] =
    w.blend === "multiply" && fit.length ? [`f.rel * (1 + ${fit.join(" + ")})`] : ["f.rel", ...fit];
  parts.push(`(case f.app_posture when 'open' then ${num(w.open)} when 'preselected_only' then ${num(-w.preselected)} else 0 end)`);
  parts.push(`(case when f.last_fy is not null and f.last_fy < ${Math.trunc(o.maxFy - STALE_AFTER_YEARS)} then ${num(-w.stale)} else 0 end)`);
  if (o.profiles && ctx.budget) {
    const b = ctx.budget;
    parts.push(
      `(case when f.median_paid_5y is null then 0
             when f.median_paid_5y between ${num(0.002 * b)} and ${num(0.25 * b)} then ${num(w.size)}
             when f.median_paid_5y > ${num(0.5 * b)} then ${num(-w.size)} else 0 end)`,
    );
  }

  const sql = `with legs as (
      ${legs.join("\n      union all\n      ")}
    ),
    cand as (
      select id,
             min(r) filter (where leg = 1) as sem_r,
             min(r) filter (where leg = 2) as kw_r,
             min(r) filter (where leg = 3) as loc_r,
             min(r) filter (where leg = 4) as giv_r
      from legs group by id
    ),
    scored as (
      select c.id, sd.org_id, sd.org_type, sd.state as doc_state, sd.app_posture,
             ((coalesce(1.0 / (60 + c.sem_r), 0)
               + ${num(w.keywordLeg)} * coalesce(1.0 / (60 + c.kw_r), 0)
               + ${num(w.localLeg)} * coalesce(1.0 / (60 + c.loc_r), 0)
               + ${num(w.localLeg)} * coalesce(1.0 / (60 + c.giv_r), 0)) * 30.5)::float8 as rel
      from cand c
      join internal.search_documents sd on sd.id = c.id
      join internal.organizations o on o.id = sd.org_id
      where o.canonical_org_id is null
        and sd.doc_kind = any(${kinds}::text[])
        and sd.org_type = any(${types}::text[])${filters.length ? `\n        and ${filters.join("\n        and ")}` : ""}
      order by rel desc, c.id
      limit ${LEG_LIMITS.features}
    ),
    feat as (
      select s.*,
             string_to_array(substring(d.doc_text from 'Grant geography: ([A-Z]{2}(?:, [A-Z]{2})*)'), ', ') as top_states,
             left(d.doc_text, 240) as snippet,
             ${causeRe ? `(d.doc_text ~* ${causeRe}::text)` : "null::boolean"} as cause_hit,
             ev.last_fy::int as last_fy${profileCols}
      from scored s
      join internal.search_documents d on d.id = s.id
      left join internal.mv_funder_event_stats ev on ev.org_id = s.org_id and ev.event_type = 'grant'${profileJoins}${filterJoins ? `\n      ${filterJoins}` : ""}
    )
    select f.org_id,
           (${parts.join("\n            + ")})::float8 as rank,
           f.snippet,
           jsonb_strip_nulls(jsonb_build_object(
             'tier', ${o.profiles ? "'profiles'" : "'summary'"},
             'state', ${st ? `${st}::text` : "null"},
             'located', ${st ? `f.doc_state = ${st}::text` : "null"},
             'topStates', to_jsonb(f.top_states),
             'inState5y', f.in_state_5y,
             'cause', ${cause ? `${cause}::text` : "null"},
             'causeMentioned', f.cause_hit,
             'cause5y', f.cause_5y,
             'grants5y', f.grants_5y,
             'median5y', f.median_paid_5y,
             'windowFirstFy', f.window_first_fy,
             'windowLastFy', f.window_last_fy,
             'lastFy', f.last_fy)) as fit
    from feat f`;
  return { sql, notices };
}

/**
 * Browse with "gives in" / "funds this cause" and the giving profiles loaded:
 * the funders that gave most there, most first.
 */
function givingPool(p: SearchParams, ps: Params): string {
  const bits = orgFilters({ ...p, givesIn: null, cause: null }, ps);
  const from = p.givesIn
    ? `internal.mv_funder_giving_state g
       join internal.organizations o on o.id = g.funder_org_id${
         p.cause
           ? `\n       join internal.mv_funder_giving_cause gc on gc.funder_org_id = g.funder_org_id and gc.ntee_major = ${ps.add(p.cause)}::text and gc.n_grants_5y >= 2`
           : ""
       }`
    : `internal.mv_funder_giving_cause g
       join internal.organizations o on o.id = g.funder_org_id`;
  const key = p.givesIn ? `g.state = ${ps.add(p.givesIn)}::text and g.n_grants_5y > 0` : `g.ntee_major = ${ps.add(p.cause)}::text and g.n_grants_5y >= 2`;
  return `select o.id as org_id, g.n_grants_5y::float8 as rank, null::text as snippet,
           jsonb_strip_nulls(jsonb_build_object('tier', 'profiles',
             ${p.givesIn ? `'state', g.state, 'inState5y', g.n_grants_5y` : `'cause', g.ntee_major, 'cause5y', g.n_grants_5y`})) as fit
    from ${from}${joins(bits)}
    where ${key}
      and ${bits.where.join("\n      and ")}
    order by g.n_grants_5y desc, o.id
    limit ${POOL_LIMIT}`;
}

function browsePool(p: SearchParams, ps: Params, profiles: boolean): string {
  const bits = orgFilters(p, ps, { profiles });
  const sortsByGiving = p.sort === "relevance" || p.sort === "distributions";
  // Ranking by giving: drive from the (smaller) financials view; orgs without
  // a parsed return sort last anyway and the pool is bounded, so nothing that
  // could reach the page is lost. Other sorts keep every organization.
  const from = sortsByGiving
    ? `internal.mv_org_latest_financials fin join internal.organizations o on o.id = fin.org_id${
        bits.needAp ? " left join internal.mv_org_application_posture ap on ap.org_id = o.id" : ""
      }`
    : `internal.organizations o${joins({ needAp: bits.needAp, needFin: bits.needFin || p.sort === "assets" })}`;
  return `select o.id as org_id, 0::float8 as rank, null::text as snippet, null::jsonb as fit
    from ${from}
    where ${bits.where.join("\n      and ")}
    order by ${poolOrder(p.sort)}
    limit ${POOL_LIMIT}`;
}

/* ------------------------------------------------------------- the build */

export function buildSearchSql(p: SearchParams, opts: BuildOptions = {}): BuiltSearch | SkippedSearch {
  const ps = new Params();
  const notices: SearchNotice[] = [];
  const u = opts.understanding ?? understand(p.q);
  const ctx = opts.context ?? EMPTY_CONTEXT;
  const profiles = opts.profilesReady === true;
  const maxFy = opts.maxFy ?? new Date().getUTCFullYear() - 1;
  const w = opts.weights ?? RANK_WEIGHTS;
  let ran: RanMode;
  let pool: string;
  let poolLimit: number;
  let rankedBrowse = false;

  if ((p.givesIn || p.cause) && !profiles) notices.push("giving_profiles_unavailable");

  if (p.ein) {
    ran = "ein";
    pool = einPool(p.ein, ps);
    poolLimit = EIN_POOL_LIMIT;
  } else if (p.q && p.mode === "name") {
    const name = nameQuery(p) ?? p.q;
    if (name.length < MIN_NAME_CHARS) return { text: null, ran: null, notices: ["name_too_short"] };
    ran = "name";
    pool = namePool(name, p, ps, profiles);
    poolLimit = POOL_LIMIT;
  } else if (p.q) {
    const vec = p.mode === "thesis" && opts.vec && opts.vec.length > 0 ? opts.vec : null;
    if (p.mode === "thesis" && !vec) notices.push("semantic_unavailable");
    ran = vec ? "semantic" : "keyword";
    const built = topicPool(p, vec, u, ctx, ps, { profiles, maxFy, w });
    pool = built.sql;
    notices.push(...built.notices);
    poolLimit = SEMANTIC_POOL_LIMIT;
  } else if (profiles && (p.givesIn || p.cause)) {
    ran = "browse";
    pool = givingPool(p, ps);
    poolLimit = POOL_LIMIT;
    rankedBrowse = p.sort === "relevance";
  } else {
    ran = "browse";
    pool = browsePool(p, ps, profiles);
    poolLimit = POOL_LIMIT;
  }

  if (p.posture) notices.push("posture_filter");
  if (p.givingTo) notices.push("giving_to_pool");

  const page = Math.min(Math.max(1, p.page), MAX_PAGE);
  const limit = ps.add(PAGE_SIZE);
  const offset = ps.add((page - 1) * PAGE_SIZE);

  const where: string[] = [];
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
       p.rank::float8 as rank, p.snippet, p.fit,${hitCols}
       count(*) over()::int as total,
       (select count(*) from pool)::int as pool_size
from pool p
join internal.organizations o on o.id = p.org_id
left join internal.mv_org_application_posture ap on ap.org_id = o.id
left join internal.mv_org_latest_financials fin on fin.org_id = o.id
left join internal.mv_funder_event_stats g on g.org_id = o.id and g.event_type = 'grant'${lateral}
${where.length ? `where ${where.join("\n  and ")}\n` : ""}order by ${outerOrder(p.sort, ran, Boolean(p.givingTo), rankedBrowse)}
limit ${limit}::int offset ${offset}::int`;

  return { text, values: ps.values, ran, poolLimit, notices };
}

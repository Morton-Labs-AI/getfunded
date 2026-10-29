import "server-only";

/**
 * Ground truth for the search eval suite (evals/search, served by
 * /api/eval/facts behind EVAL_TOKEN). For each funder: what its own filings
 * say it paid, by recipient state and recipient NTEE group, over the corpus's
 * last five fiscal years, plus how many of those grants mention a topic.
 *
 * These are read from the grant rows themselves (the same live rows the
 * funder page counts: superseded filings excluded), never from the search
 * index or the ranking views, so a label cannot agree with the ranker merely
 * because both read the same shortcut.
 */
import { corpusQuery } from "@/lib/db/corpus";

export type FunderFacts = {
  grantsAll: number;
  grants5y: number;
  firstFy: number | null;
  lastFy: number | null;
  /** Median paid grant over the window, in dollars; null with no positive amounts. */
  median5y: number | null;
  /** Grants in the window whose recipient is linked to an organization record. */
  linked5y: number;
  byState5y: Record<string, number>;
  byCause5y: Record<string, number>;
  /** Grants in the window whose purpose or recipient name matches `topic`; null when no topic was asked. */
  topic5y: number | null;
};

export type EvalFacts = { maxFy: number; minFy: number; funders: Record<string, FunderFacts> };

export const EVAL_FACTS_MAX_IDS = 60;
export const EVAL_WINDOW_YEARS = 5;

let cachedMaxFy: number | null = null;

const LIVE = `pe.event_type = 'grant'
  and (pe.filing_object_id is null or not exists (
        select 1 from internal.filings sf
        where sf.object_id = pe.filing_object_id and sf.superseded_by_object_id is not null))`;

function emptyFacts(topic: string | null): FunderFacts {
  return { grantsAll: 0, grants5y: 0, firstFy: null, lastFy: null, median5y: null, linked5y: 0, byState5y: {}, byCause5y: {}, topic5y: topic ? 0 : null };
}

export async function readEvalFacts(ids: string[], topic: string | null): Promise<EvalFacts> {
  return corpusQuery(async (sql) => {
    if (cachedMaxFy === null) {
      // The latest fiscal year most funders have reached; a handful of early
      // filers for the current year must not shift the window.
      const r = await sql<{ fy: number | null }[]>`
        select percentile_disc(0.99) within group (order by last_fy)::int as fy
        from internal.mv_funder_event_stats where event_type = 'grant'`;
      cachedMaxFy = r[0]?.fy ?? new Date().getUTCFullYear() - 1;
    }
    const maxFy = cachedMaxFy;
    const minFy = maxFy - (EVAL_WINDOW_YEARS - 1);
    const funders: Record<string, FunderFacts> = Object.fromEntries(ids.map((id) => [id, emptyFacts(topic)]));
    if (ids.length === 0) return { maxFy, minFy, funders };

    // All-time counts come from the stats view; everything in the window from
    // ONE pass over the funders' live grants, aggregated three ways.
    const allTime = await sql.unsafe<{ id: string; n: string; first_fy: number | null; last_fy: number | null }[]>(
      `select org_id::text as id, n::text, first_fy::int, last_fy::int
       from internal.mv_funder_event_stats where org_id = any($1::uuid[]) and event_type = 'grant'`,
      [ids] as never[],
    );
    for (const r of allTime) {
      const f = funders[r.id];
      if (!f) continue;
      f.grantsAll = Number(r.n);
      f.firstFy = r.first_fy;
      f.lastFy = r.last_fy;
    }

    const rows = await sql.unsafe<{ k: string; id: string; key: string | null; n: number; med: number | null; linked: number | null }[]>(
      `with g as materialized (
         select pe.funder_org_id, pe.recipient_state, pe.recipient_org_id, pe.amount
         from public.funding_events pe
         where pe.funder_org_id = any($1::uuid[]) and pe.fiscal_year >= $2 and ${LIVE}
       )
       select 'sum' as k, g.funder_org_id::text as id, null::text as key, count(*)::int as n,
              (percentile_cont(0.5) within group (order by g.amount) filter (where g.amount > 0))::float8 as med,
              count(*) filter (where g.recipient_org_id is not null)::int as linked
       from g group by g.funder_org_id
       union all
       select 'st', g.funder_org_id::text, upper(trim(g.recipient_state)), count(*)::int, null, null
       from g where g.recipient_state is not null group by 2, 3
       union all
       select 'c', g.funder_org_id::text, upper(left(ro.ntee_code, 1)), count(*)::int, null, null
       from g join internal.organizations ro on ro.id = g.recipient_org_id
       where ro.ntee_code is not null group by 2, 3`,
      [ids, minFy] as never[],
    );
    for (const r of rows) {
      const f = funders[r.id];
      if (!f) continue;
      if (r.k === "sum") {
        f.grants5y = r.n;
        f.median5y = r.med === null ? null : Math.round(r.med);
        f.linked5y = r.linked ?? 0;
      } else if (r.k === "st" && r.key && /^[A-Z]{2}$/.test(r.key)) f.byState5y[r.key] = r.n;
      else if (r.k === "c" && r.key && /^[A-Z]$/.test(r.key)) f.byCause5y[r.key] = r.n;
    }

    if (topic) {
      // websearch_to_tsquery never raises on user syntax; "OR" joins alternatives.
      // The tsvector lives on the table; the view supplies the licence filter
      // and the filing id the superseded check needs.
      const topical = await sql.unsafe<{ id: string; n: number }[]>(
        `select fe.funder_org_id::text as id, count(*)::int as n
         from internal.funding_events fe
         join public.funding_events pe on pe.id = fe.id
         where fe.funder_org_id = any($1::uuid[]) and fe.fiscal_year >= $2
           and fe.search_tsv @@ websearch_to_tsquery('english', $3::text) and ${LIVE}
         group by 1`,
        [ids, minFy, topic] as never[],
      );
      for (const r of topical) if (funders[r.id]) funders[r.id].topic5y = r.n;
    }
    return { maxFy, minFy, funders };
  });
}

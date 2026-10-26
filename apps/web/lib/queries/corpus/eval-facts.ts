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

    const summary = await sql.unsafe<
      { id: string; n_all: number; n_5y: number; first_fy: number | null; last_fy: number | null; median_5y: number | null; linked_5y: number }[]
    >(
      `select pe.funder_org_id::text as id, count(*)::int as n_all,
              count(*) filter (where pe.fiscal_year >= $2)::int as n_5y,
              min(pe.fiscal_year)::int as first_fy, max(pe.fiscal_year)::int as last_fy,
              (percentile_cont(0.5) within group (order by pe.amount)
                 filter (where pe.fiscal_year >= $2 and pe.amount > 0))::float8 as median_5y,
              count(*) filter (where pe.fiscal_year >= $2 and pe.recipient_org_id is not null)::int as linked_5y
       from public.funding_events pe
       where pe.funder_org_id = any($1::uuid[]) and ${LIVE}
       group by 1`,
      [ids, minFy] as never[],
    );
    for (const s of summary) {
      const f = funders[s.id];
      if (!f) continue;
      f.grantsAll = s.n_all;
      f.grants5y = s.n_5y;
      f.firstFy = s.first_fy;
      f.lastFy = s.last_fy;
      f.median5y = s.median_5y === null ? null : Math.round(s.median_5y);
      f.linked5y = s.linked_5y;
    }

    const byState = await sql.unsafe<{ id: string; st: string; n: number }[]>(
      `select pe.funder_org_id::text as id, upper(trim(pe.recipient_state)) as st, count(*)::int as n
       from public.funding_events pe
       where pe.funder_org_id = any($1::uuid[]) and pe.fiscal_year >= $2 and pe.recipient_state is not null and ${LIVE}
       group by 1, 2`,
      [ids, minFy] as never[],
    );
    for (const r of byState) if (funders[r.id] && /^[A-Z]{2}$/.test(r.st)) funders[r.id].byState5y[r.st] = r.n;

    const byCause = await sql.unsafe<{ id: string; c: string; n: number }[]>(
      `select pe.funder_org_id::text as id, upper(left(ro.ntee_code, 1)) as c, count(*)::int as n
       from public.funding_events pe
       join internal.organizations ro on ro.id = pe.recipient_org_id
       where pe.funder_org_id = any($1::uuid[]) and pe.fiscal_year >= $2 and ro.ntee_code is not null and ${LIVE}
       group by 1, 2`,
      [ids, minFy] as never[],
    );
    for (const r of byCause) if (funders[r.id] && /^[A-Z]$/.test(r.c)) funders[r.id].byCause5y[r.c] = r.n;

    if (topic) {
      // websearch_to_tsquery never raises on user syntax; "OR" joins alternatives.
      const topical = await sql.unsafe<{ id: string; n: number }[]>(
        `select pe.funder_org_id::text as id, count(*)::int as n
         from internal.funding_events pe
         where pe.funder_org_id = any($1::uuid[]) and pe.fiscal_year >= $2
           and pe.search_tsv @@ websearch_to_tsquery('english', $3::text) and ${LIVE}
         group by 1`,
        [ids, minFy, topic] as never[],
      );
      for (const r of topical) if (funders[r.id]) funders[r.id].topic5y = r.n;
    }
    return { maxFy, minFy, funders };
  });
}

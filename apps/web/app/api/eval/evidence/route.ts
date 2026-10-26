/**
 * GET /api/eval/evidence?ids=<uuid,...>
 *
 * What a judge needs to grade a funder as a lead (evals/search/judge.mjs):
 * its most frequent grant purposes and its largest recipients in the corpus's
 * last five fiscal years, from its live grant rows. Like /api/eval/facts, it
 * exists only on a deployment that set EVAL_TOKEN and only for a request that
 * carries it; elsewhere it is a 404.
 */
import { DbError } from "@/lib/db/app";
import { corpusQuery } from "@/lib/db/corpus";
import { evalTokenOk } from "@/lib/eval/token";
import { jsonError } from "@/lib/security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDS = 12;

const LIVE = `pe.event_type = 'grant'
  and (pe.filing_object_id is null or not exists (
        select 1 from internal.filings sf
        where sf.object_id = pe.filing_object_id and sf.superseded_by_object_id is not null))`;

export async function GET(req: Request): Promise<Response> {
  if (!evalTokenOk(req)) return jsonError(404, "not_found", "Not found.");
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => UUID_RE.test(id))) {
    return jsonError(400, "bad_ids", `Pass 1 to ${MAX_IDS} organization ids, comma separated.`);
  }
  const minFy = new Date().getUTCFullYear() - 5;
  try {
    const rows = await corpusQuery(async (sql) => {
      const purposes = await sql.unsafe<{ id: string; purpose: string; n: number }[]>(
        `select id, purpose, n from (
           select pe.funder_org_id::text as id, upper(left(btrim(pe.purpose_text), 120)) as purpose, count(*)::int as n,
                  row_number() over (partition by pe.funder_org_id order by count(*) desc, upper(left(btrim(pe.purpose_text), 120))) as rk
           from public.funding_events pe
           where pe.funder_org_id = any($1::uuid[]) and pe.fiscal_year >= $2 and pe.purpose_text is not null and ${LIVE}
           group by pe.funder_org_id, upper(left(btrim(pe.purpose_text), 120))) t
         where rk <= 8`,
        [ids, minFy] as never[],
      );
      const recipients = await sql.unsafe<{ id: string; recipient: string; state: string | null; total: string | null }[]>(
        `select id, recipient, state, total::text from (
           select pe.funder_org_id::text as id, upper(btrim(pe.recipient_name)) as recipient, max(pe.recipient_state) as state,
                  sum(pe.amount) as total,
                  row_number() over (partition by pe.funder_org_id order by sum(pe.amount) desc nulls last, upper(btrim(pe.recipient_name))) as rk
           from public.funding_events pe
           where pe.funder_org_id = any($1::uuid[]) and pe.fiscal_year >= $2 and pe.recipient_name is not null and ${LIVE}
           group by pe.funder_org_id, upper(btrim(pe.recipient_name))) t
         where rk <= 6`,
        [ids, minFy] as never[],
      );
      return { purposes, recipients };
    });
    const out: Record<string, { purposes: { purpose: string; n: number }[]; recipients: { name: string; state: string | null; total: number | null }[] }> = {};
    for (const id of ids) out[id] = { purposes: [], recipients: [] };
    for (const p of rows.purposes) out[p.id]?.purposes.push({ purpose: p.purpose, n: p.n });
    for (const r of rows.recipients) out[r.id]?.recipients.push({ name: r.recipient, state: r.state, total: r.total === null ? null : Math.round(Number(r.total)) });
    return Response.json({ minFy, funders: out }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const e = DbError.from(err);
    if (DbError.is(e, "timeout")) return jsonError(504, "timeout", "The evidence query took too long; ask for fewer ids.");
    console.error("[api/eval/evidence]", e instanceof Error ? e.message : e);
    return jsonError(500, "evidence_failed", "The evidence could not be read.");
  }
}

/**
 * GET /api/eval/facts?ids=<uuid,uuid,...>&topic=<websearch text>
 *
 * Ground truth for the search eval suite (evals/search). Exists only on a
 * deployment that set EVAL_TOKEN, and only for a request that carries it in
 * `x-eval-token` (lib/eval/token.ts); everywhere else it is a 404, so
 * production exposes nothing. Read-only, like every corpus reader.
 */
import { DbError } from "@/lib/db/app";
import { evalTokenOk } from "@/lib/eval/token";
import { EVAL_FACTS_MAX_IDS, readEvalFacts } from "@/lib/queries/corpus/eval-facts";
import { jsonError } from "@/lib/security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request): Promise<Response> {
  if (!evalTokenOk(req)) return jsonError(404, "not_found", "Not found.");
  const url = new URL(req.url);
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (ids.length === 0 || ids.length > EVAL_FACTS_MAX_IDS || !ids.every((id) => UUID_RE.test(id))) {
    return jsonError(400, "bad_ids", `Pass 1 to ${EVAL_FACTS_MAX_IDS} organization ids, comma separated.`);
  }
  const topic = url.searchParams.get("topic")?.replace(/\s+/g, " ").trim().slice(0, 300) || null;
  try {
    const facts = await readEvalFacts(ids, topic);
    return Response.json(facts, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const e = DbError.from(err);
    if (DbError.is(e, "timeout")) return jsonError(504, "timeout", "The facts query took too long; ask for fewer ids.");
    console.error("[api/eval/facts]", e instanceof Error ? e.message : e);
    return jsonError(500, "facts_failed", "The facts could not be read.");
  }
}

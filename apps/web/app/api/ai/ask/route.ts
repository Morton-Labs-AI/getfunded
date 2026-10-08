/**
 * POST /api/ai/ask  { question, history? }  →  text/event-stream
 *
 * "Ask the analyst": one question → one read-only SQL query on the `funder_ro`
 * pool → the rows → a streamed plain-language explanation. Same-origin,
 * signed in, plan gate `ask`, metered as 'ask' (2 credits) inside runAsk().
 *
 * Events (lib/ai/sse.ts), one JSON object per `data:` line:
 *   phase · sql · rows | sql_error · text (deltas) · usage · error · done
 *
 * Failures before the first event (quota, kill switch, ANALYST_DATABASE_URL
 * unset → 503 not_configured) come back as ordinary JSON with a status, so a
 * fetch() caller can read them without parsing a stream. Failures after that
 * arrive as an `error` event followed by `done`.
 *
 * The run keeps going after the browser disconnects, under `after()`, so the
 * ledger row is always settled or refunded; `maxDuration` gives the whole
 * exchange (two model calls, one 15 s query, the streamed explanation) room
 * to finish on the platform.
 */
import { after } from "next/server";

import { AskBody } from "@/lib/ai/api-schemas";
import { runAsk } from "@/lib/ai/ask";
import { askStream } from "@/lib/ai/ask-stream";
import { aiRoute } from "@/lib/ai/route";
import { boundedJson } from "@/lib/security";

export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  return aiRoute(req, "ask", async ({ ctx }) => {
    const body = await boundedJson(req, AskBody, 128_000);
    const { response, settled } = await askStream((emit) => runAsk(ctx, body, emit), { signal: req.signal });
    // Settle the credits even when nobody is listening any more.
    after(() => settled);
    return response;
  });
}

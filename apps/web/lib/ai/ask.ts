import "server-only";
/**
 * "Ask the analyst": one question → one read-only SQL query over the public
 * views and the internal matviews → the result → a plain-language
 * explanation. Metered as 'ask' (2 credits) for the whole exchange.
 *
 * The model-written SQL runs ONLY on the `analyst` pool (role `funder_ro`,
 * read-only at the role level, granted exactly the guard's allowlist by
 * migration getfunded_0010), inside `begin read only` with
 * `search_path = public`, `standard_conforming_strings = on` and a 15 s
 * statement timeout, after `guardSql()` and a LIMIT wrap at 500 rows. The
 * query itself goes over the extended protocol (Parse/Bind/Execute), so the
 * server refuses a second statement even if the guard ever missed one. When
 * ANALYST_DATABASE_URL is unset the feature refuses with "Not configured on
 * this install".
 *
 * Events are emitted through `emit()` as they happen so the route can stream
 * them: phase → sql → rows | sql_error (one repair) → text deltas → usage → done.
 */
import type postgres from "postgres";
import { z } from "zod";
import { addUsage, type AiClient, type AiRequest, type MessageParam, type Usage } from "@/lib/ai/types";
import { meter, type MeterDeps } from "@/lib/billing/meter";
import { analyst as analystPool, analystEnabled } from "@/lib/db/corpus";
import { AskBody } from "./api-schemas";
import {
  ASK_PROMPT_VERSION,
  MOCK_ASK_QUERY,
  buildAskSystem,
  buildExplainSystem,
  buildExplainUser,
  buildQueryTool,
  buildRepairMessage,
} from "./ask-prompt";
import { normalizeToolInput } from "./evidence";
import { AiNotConfiguredError, AiOutputRejectedError } from "./http";
import { GuardError, ROW_CAP, guardSql, pgTypeName, serializeValue, textTable, wrapWithLimit, type GuardedResult } from "./sql-guard";
import type { AskEvent } from "./sse";

/**
 * Query options that force the extended protocol with the unnamed statement.
 * postgres.js picks the simple protocol whenever there are no parameters
 * unless told otherwise; the simple protocol accepts several statements in
 * one string, the extended protocol refuses them ("cannot insert multiple
 * commands into a prepared statement"). `simple` is not in the published
 * types, hence the cast.
 */
export const EXTENDED_PROTOCOL = { prepare: false, simple: false } as postgres.UnsafeQueryOptions;

/** The request body and the engine input are one schema (lib/ai/api-schemas.ts). */
export const AskInput = AskBody;
export type AskInput = z.infer<typeof AskInput>;

export type AskDeps = MeterDeps & {
  /** The analyst pool (tests pass a fake). `null` means not configured. */
  analyst?: postgres.Sql | null;
  /** Milliseconds for the statement timeout inside the read-only transaction. */
  statementTimeoutMs?: number;
};

export type Emit = (event: AskEvent) => void;

const QueryCall = z.object({ sql: z.string().min(1).max(20_000), purpose: z.string().max(400).default("Query") });

/**
 * Run one guarded query on the analyst pool: READ ONLY transaction,
 * search_path pinned to public, standard string lexing pinned on (so the
 * guard and the server agree on where every literal ends), statement
 * timeout, LIMIT wrap, extended protocol. Throws `GuardError` for a rejected
 * query and the Postgres error for a failed one.
 */
export async function executeGuardedSql(pool: postgres.Sql, raw: string, opts: { statementTimeoutMs?: number } = {}): Promise<GuardedResult> {
  const q = guardSql(raw);
  const wrapped = wrapWithLimit(q);
  const timeout = Math.max(1000, Math.min(15_000, opts.statementTimeoutMs ?? 15_000));
  const t0 = performance.now();
  const result = await pool.begin("read only", async (tx) => {
    await tx.unsafe(`set local statement_timeout = '${timeout}ms'`);
    await tx.unsafe("set local search_path = public");
    await tx.unsafe("set local standard_conforming_strings = on");
    return tx.unsafe(wrapped, [], EXTENDED_PROTOCOL);
  });
  const ms = Math.round(performance.now() - t0);
  const rowsIn = result as unknown as Record<string, unknown>[];
  // postgres.js hangs the RowDescription on the result: name and pg_type oid per column.
  const meta = (result as unknown as { columns?: { name: string; type?: number }[] }).columns;
  const columns = meta?.map((c) => c.name) ?? Object.keys(rowsIn[0] ?? {});
  const types = meta?.map((c) => pgTypeName(c.type));
  const rows = rowsIn.map((r) => columns.map((c) => serializeValue(r[c])));
  return { columns, ...(types ? { types } : {}), rows, rowCount: rows.length, ms, capped: rows.length >= ROW_CAP };
}

function historyMessages(history: AskInput["history"]): MessageParam[] {
  const out: MessageParam[] = [];
  for (const h of history ?? []) {
    // Keep alternation valid: the API refuses two consecutive turns of one role.
    const last = out[out.length - 1];
    if (last && last.role === h.role) {
      last.content = `${String(last.content)}\n\n${h.content}`;
      continue;
    }
    out.push({ role: h.role, content: h.content });
  }
  if (out.length > 0 && out[0].role !== "user") out.shift();
  if (out.length > 0 && out[out.length - 1].role === "user") out.pop();
  return out;
}

/** Ask the model for the query (forced tool). In mock mode a known-safe query is used so the pipeline still runs end to end. */
async function writeQuery(ai: AiClient, messages: MessageParam[], userId: string): Promise<{ sql: string; purpose: string; usage: Usage }> {
  const tool = buildQueryTool();
  const req: AiRequest = { system: buildAskSystem(), messages, tools: [tool], toolChoice: { name: tool.name }, maxTokens: 4000, effort: "low", userId };
  const res = await ai.fast(req);
  if (res.mock) return { ...MOCK_ASK_QUERY, usage: res.usage };
  const parsed = QueryCall.safeParse(normalizeToolInput(res.toolInput));
  if (!parsed.success) throw new AiOutputRejectedError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), res.usage);
  return { sql: parsed.data.sql, purpose: parsed.data.purpose, usage: res.usage };
}

/**
 * The whole exchange for one question. Resolves when the `done` event has
 * been emitted; throws typed errors (quota, disabled, not configured) BEFORE
 * any event when the request cannot start, so the route can answer with JSON.
 */
export async function runAsk(ctx: { userId: string; workspaceId: string }, inputIn: AskInput, emit: Emit, deps: AskDeps = {}): Promise<void> {
  const input = AskInput.parse(inputIn);
  const pool = deps.analyst === undefined ? (analystEnabled ? analystPool : null) : deps.analyst;
  if (!pool) throw new AiNotConfiguredError("Ask the analyst is not configured on this install (ANALYST_DATABASE_URL).");

  await meter(
    { userId: ctx.userId, workspaceId: ctx.workspaceId, feature: "ask", meta: { prompt_version: ASK_PROMPT_VERSION } },
    async (ai, reservation) => {
      emit({ type: "phase", phase: "write" });
      const messages: MessageParam[] = [...historyMessages(input.history), { role: "user", content: input.question }];
      let { sql, purpose, usage } = await writeQuery(ai, messages, ctx.userId);

      emit({ type: "phase", phase: "run" });
      emit({ type: "sql", sql, purpose });
      let result: GuardedResult | null = null;
      let error: string | null = null;
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try {
          result = await executeGuardedSql(pool, sql, { statementTimeoutMs: deps.statementTimeoutMs });
          emit({
            type: "rows",
            columns: result.columns,
            ...(result.types ? { types: result.types } : {}),
            rows: result.rows,
            total: result.rowCount,
            ms: result.ms,
            capped: result.capped,
          });
          error = null;
        } catch (err) {
          error = err instanceof GuardError ? err.message : err instanceof Error ? err.message.slice(0, 400) : String(err);
          emit({ type: "sql_error", message: error });
          if (attempt === 0 && ai.mode !== "mock") {
            messages.push({ role: "assistant", content: JSON.stringify({ sql, purpose }) });
            messages.push({ role: "user", content: buildRepairMessage(error) });
            const repaired = await writeQuery(ai, messages, ctx.userId);
            usage = addUsage(usage, repaired.usage);
            sql = repaired.sql;
            purpose = repaired.purpose;
            emit({ type: "sql", sql, purpose, repaired: true });
          } else {
            break;
          }
        }
      }

      emit({ type: "phase", phase: "explain" });
      const explainReq: AiRequest = {
        system: buildExplainSystem(),
        messages: [{ role: "user", content: buildExplainUser({ question: input.question, sql, purpose, table: result ? textTable(result) : null, error }) }],
        maxTokens: 1200,
        effort: "low",
        tier: "fast",
        userId: ctx.userId,
      };
      const explained = await ai.stream(explainReq, (delta) => emit({ type: "text", text: delta }));
      usage = addUsage(usage, explained.usage);

      emit({
        type: "usage",
        credits: reservation.credits,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        model: usage.model,
        mock: ai.mode === "mock",
      });
      emit({ type: "done" });
      return { result: undefined, usage };
    },
    deps,
  );
}

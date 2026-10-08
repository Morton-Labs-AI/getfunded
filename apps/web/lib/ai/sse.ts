/**
 * Server-sent event framing for "Ask the analyst". Pure: the route encodes
 * with `sseFrame`, the chat component decodes with `parseSseFrames`, and one
 * test round-trips both.
 */
/**
 * Postgres column types as the rows event names them, mapped from the type
 * oids postgres.js reports (`pgTypeName` in lib/ai/sql-guard.ts). The chat
 * uses them to pick a formatter: an integer is never shown as dollars.
 */
export type ColumnType = "int" | "numeric" | "float" | "date" | "timestamp" | "bool" | "text" | "unknown";

export type AskEvent =
  | { type: "phase"; phase: "write" | "run" | "explain" }
  | { type: "sql"; sql: string; purpose: string; repaired?: boolean }
  | {
      type: "rows";
      columns: string[];
      /** One entry per column, when the server knows them (older servers omit it). */
      types?: ColumnType[];
      rows: Array<Array<string | number | boolean | null>>;
      total: number;
      ms: number;
      capped: boolean;
    }
  | { type: "sql_error"; message: string }
  | { type: "text"; text: string }
  | { type: "usage"; credits: number; inputTokens: number; outputTokens: number; model: string; mock: boolean }
  | { type: "error"; code: string; message: string; status: number; upgradeUrl?: string }
  | { type: "done" };

export function sseFrame(event: AskEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function sseHeaders(): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}

/**
 * Split a buffer of SSE text into complete events and the unfinished tail.
 * Lines that are not `data:` (comments, ids) are ignored; malformed JSON is skipped.
 */
export function parseSseFrames(buffer: string): { events: AskEvent[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: AskEvent[] = [];
  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as AskEvent;
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") events.push(parsed);
    } catch {
      /* skip a malformed frame */
    }
  }
  return { events, rest };
}

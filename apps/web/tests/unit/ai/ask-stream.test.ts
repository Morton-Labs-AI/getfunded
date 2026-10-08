// @vitest-environment node
/**
 * askStreamResponse (lib/ai/ask-stream.ts): a run that fails before its first
 * event answers as JSON with the typed status; a run that has started streams
 * events and reports a later failure as an `error` event followed by `done`.
 */
import { describe, expect, it, vi } from "vitest";

import { askStreamResponse, errorEventFor } from "@/lib/ai/ask-stream";
import { AiNotConfiguredError, AiOutputRejectedError } from "@/lib/ai/http";
import { parseSseFrames, type AskEvent } from "@/lib/ai/sse";
import { AiDisabledError } from "@/lib/ai/types";
import { QuotaExceededError } from "@/lib/billing/quota";

async function eventsOf(res: Response): Promise<AskEvent[]> {
  const text = await res.text();
  const { events, rest } = parseSseFrames(text);
  expect(rest).toBe("");
  return events;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("askStreamResponse", () => {
  it("streams every emitted event as SSE and ends when the run resolves", async () => {
    const res = await askStreamResponse(async (emit) => {
      emit({ type: "phase", phase: "write" });
      await tick();
      emit({ type: "sql", sql: "select 1", purpose: "One" });
      emit({ type: "rows", columns: ["?column?"], rows: [[1]], total: 1, ms: 3, capped: false });
      emit({ type: "text", text: "One row." });
      emit({ type: "usage", credits: 2, inputTokens: 10, outputTokens: 5, model: "mock", mock: true });
      emit({ type: "done" });
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const events = await eventsOf(res);
    expect(events.map((e) => e.type)).toEqual(["phase", "sql", "rows", "text", "usage", "done"]);
  });

  it("answers 402 JSON when the quota is exceeded before any event", async () => {
    const res = await askStreamResponse(async () => {
      await tick();
      throw new QuotaExceededError({ used: 25, limit: 25, periodEnd: new Date("2026-11-01T00:00:00Z"), feature: "ask", scope: "monthly" });
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.upgradeUrl).toBe("/pricing");
    expect(body.error.used).toBe(25);
  });

  it("answers 503 JSON for the kill switch and for a missing analyst connection", async () => {
    const disabled = await askStreamResponse(async () => {
      throw new AiDisabledError();
    });
    expect(disabled.status).toBe(503);
    expect((await disabled.json()).error.code).toBe("ai_disabled");

    const unconfigured = await askStreamResponse(async () => {
      throw new AiNotConfiguredError("Ask the analyst is not configured on this install (ANALYST_DATABASE_URL).");
    });
    expect(unconfigured.status).toBe(503);
    expect((await unconfigured.json()).error.code).toBe("not_configured");
  });

  it("answers a generic 500 for an unexpected error before any event, without leaking the message", async () => {
    const log = vi.fn();
    const res = await askStreamResponse(
      async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.1:5432");
      },
      { log },
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(log).toHaveBeenCalled();
  });

  it("after the first event, a failure becomes an error event followed by done", async () => {
    const log = vi.fn();
    const res = await askStreamResponse(
      async (emit) => {
        emit({ type: "phase", phase: "write" });
        await tick();
        throw new AiOutputRejectedError(["sql: Required"], null);
      },
      { log },
    );
    expect(res.status).toBe(200);
    const events = await eventsOf(res);
    expect(events[0]).toEqual({ type: "phase", phase: "write" });
    expect(events[1]).toMatchObject({ type: "error", code: "ai_output_rejected", status: 502 });
    expect(events[2]).toEqual({ type: "done" });
    expect(log).toHaveBeenCalled();
  });

  it("a quota failure after start carries the upgrade link in the error event", async () => {
    const res = await askStreamResponse(async (emit) => {
      emit({ type: "phase", phase: "write" });
      throw new QuotaExceededError({ used: 9, limit: 9, periodEnd: null, feature: "ask", scope: "daily" });
    });
    const events = await eventsOf(res);
    expect(events[1]).toMatchObject({ type: "error", code: "quota_exceeded", status: 402, upgradeUrl: "/pricing" });
  });

  it("a run that resolves without emitting still closes the stream with done", async () => {
    const res = await askStreamResponse(async () => undefined);
    expect(res.status).toBe(200);
    expect(await eventsOf(res)).toEqual([{ type: "done" }]);
  });

  it("stops enqueuing after the client aborts and still lets the run finish", async () => {
    const ctrl = new AbortController();
    let finished = false;
    const res = await askStreamResponse(
      async (emit) => {
        emit({ type: "phase", phase: "write" });
        await tick();
        ctrl.abort();
        emit({ type: "text", text: "late" });
        finished = true;
      },
      { signal: ctrl.signal },
    );
    expect(res.status).toBe(200);
    await tick();
    await tick();
    expect(finished).toBe(true);
  });

  it("errorEventFor maps unknown errors to a generic message", () => {
    expect(errorEventFor(new Error("secret detail"))).toEqual({ type: "error", code: "internal_error", message: "Something went wrong on our side. Please try again.", status: 500 });
  });
});

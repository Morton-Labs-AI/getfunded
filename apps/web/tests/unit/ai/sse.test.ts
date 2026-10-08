// @vitest-environment node
/**
 * SSE framing for "Ask the analyst" (lib/ai/sse.ts): the route encodes with
 * sseFrame, the chat decodes with parseSseFrames, and the two round-trip
 * through arbitrary chunk boundaries.
 */
import { describe, expect, it } from "vitest";

import { parseSseFrames, sseFrame, sseHeaders, type AskEvent } from "@/lib/ai/sse";

const EVENTS: AskEvent[] = [
  { type: "phase", phase: "write" },
  { type: "sql", sql: "select o.id as org_id, o.name\nfrom public.organizations o\nlimit 5", purpose: "Five organizations" },
  { type: "rows", columns: ["org_id", "name"], types: ["text", "text"], rows: [["11111111-1111-4111-8111-111111111111", "Example Fund"], ["2", null]], total: 2, ms: 12, capped: false },
  { type: "text", text: "Two rows came back.\n\nBoth are " },
  { type: "text", text: "foundations." },
  { type: "usage", credits: 2, inputTokens: 1200, outputTokens: 80, model: "mock", mock: true },
  { type: "done" },
];

describe("sseFrame / parseSseFrames", () => {
  it("frames one event per data: line, terminated by a blank line", () => {
    const frame = sseFrame({ type: "phase", phase: "run" });
    expect(frame).toBe('data: {"type":"phase","phase":"run"}\n\n');
  });

  it("round-trips a whole stream, including embedded newlines and nulls", () => {
    const wire = EVENTS.map(sseFrame).join("");
    const { events, rest } = parseSseFrames(wire);
    expect(rest).toBe("");
    expect(events).toEqual(EVENTS);
  });

  it("returns the unfinished tail so a split frame is parsed on the next chunk", () => {
    const wire = EVENTS.map(sseFrame).join("");
    const cut = wire.indexOf('"rows"') + 4; // inside the third frame
    const first = parseSseFrames(wire.slice(0, cut));
    expect(first.events).toEqual(EVENTS.slice(0, 2));
    expect(first.rest.length).toBeGreaterThan(0);
    const second = parseSseFrames(first.rest + wire.slice(cut));
    expect(second.events).toEqual(EVENTS.slice(2));
    expect(second.rest).toBe("");
  });

  it("decodes byte-by-byte the same as all at once", () => {
    const wire = EVENTS.map(sseFrame).join("");
    const out: AskEvent[] = [];
    let buffer = "";
    for (const ch of wire) {
      buffer += ch;
      const { events, rest } = parseSseFrames(buffer);
      out.push(...events);
      buffer = rest;
    }
    expect(out).toEqual(EVENTS);
  });

  it("skips comments, ids, malformed JSON and frames without a type", () => {
    const wire = ": keep-alive\n\n" + "id: 7\ndata: {\"type\":\"done\"}\n\n" + "data: {not json}\n\n" + 'data: {"noType":true}\n\n' + "data: \n\n";
    const { events, rest } = parseSseFrames(wire);
    expect(events).toEqual([{ type: "done" }]);
    expect(rest).toBe("");
  });

  it("sends event-stream headers that disable caching and proxy buffering", () => {
    const h = sseHeaders();
    expect(h["content-type"]).toMatch(/^text\/event-stream/);
    expect(h["cache-control"]).toContain("no-cache");
    expect(h["x-accel-buffering"]).toBe("no");
  });
});

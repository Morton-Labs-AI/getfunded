// @vitest-environment node
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEFAULT_DEEP_MODEL,
  DEFAULT_FAST_MODEL,
  aiMode,
  effortFor,
  fromMessage,
  getAiClient,
  makeAiClient,
  mockResponse,
  modelAcceptsTemperature,
  modelsFromEnv,
  resetAiClientForTests,
  toCreateParams,
} from "@/lib/ai/client";
import { AiDisabledError, AiNoToolCallError, AiRefusedError, type AiRequest, type Tool } from "@/lib/ai/types";

const emitTool: Tool = {
  name: "emit_fit",
  description: "Emit the fit analysis",
  input_schema: {
    type: "object",
    properties: {
      score: { type: "integer", minimum: 0, maximum: 100 },
      rating: { type: "string", enum: ["strong", "possible", "weak"] },
      summary: { type: "string", maxLength: 40 },
      reasons: { type: "array", minItems: 1, maxItems: 3, items: { type: "object", properties: { statement: { type: "string" }, evidence_ids: { type: "array", items: { type: "string" } } }, required: ["statement", "evidence_ids"] } },
      optional_note: { type: "string" },
    },
    required: ["score", "rating", "summary", "reasons"],
  },
};

const baseReq: AiRequest = {
  system: "You score funders.",
  messages: [{ role: "user", content: "Score the Example Foundation for a food bank." }],
};

describe("aiMode / models", () => {
  it("AI_MODE=mock wins, AI_ENABLED=false disables, otherwise live", () => {
    expect(aiMode({})).toBe("live");
    expect(aiMode({ AI_ENABLED: "false" })).toBe("disabled");
    expect(aiMode({ AI_ENABLED: "0" })).toBe("disabled");
    expect(aiMode({ AI_ENABLED: "true" })).toBe("live");
    expect(aiMode({ AI_MODE: "mock", AI_ENABLED: "false" })).toBe("mock");
    expect(aiMode({ AI_MODE: "MOCK" })).toBe("mock");
  });
  it("model defaults and overrides", () => {
    expect(modelsFromEnv({})).toEqual({ fast: DEFAULT_FAST_MODEL, deep: DEFAULT_DEEP_MODEL });
    expect(DEFAULT_FAST_MODEL).toBe("claude-sonnet-5-5");
    expect(DEFAULT_DEEP_MODEL).toBe("claude-opus-5-5");
    expect(modelsFromEnv({ AI_MODEL_FAST: "claude-haiku-4-5", AI_MODEL_DEEP: " claude-opus-5 " })).toEqual({ fast: "claude-haiku-4-5", deep: "claude-opus-5" });
  });
  it("getAiClient memoises per environment", () => {
    resetAiClientForTests();
    const a = getAiClient({ AI_MODE: "mock" });
    expect(a).toBe(getAiClient({ AI_MODE: "mock" }));
    expect(a.mode).toBe("mock");
    expect(getAiClient({ AI_ENABLED: "false" }).mode).toBe("disabled");
    resetAiClientForTests();
  });
});

describe("toCreateParams", () => {
  it("plain request: model, tier defaults, effort, no tools", () => {
    const p = toCreateParams(baseReq, "claude-sonnet-5-5", "fast");
    expect(p).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 8192, system: "You score funders.", output_config: { effort: "low" } });
    expect(p.tools).toBeUndefined();
    expect(p.tool_choice).toBeUndefined();
    expect(p.temperature).toBeUndefined();
    expect(toCreateParams(baseReq, "claude-opus-5-5", "deep")).toMatchObject({ max_tokens: 16000, output_config: { effort: "high" } });
    expect(toCreateParams({ ...baseReq, maxTokens: 500, effort: "max" }, "claude-opus-5-5", "fast")).toMatchObject({ max_tokens: 500, output_config: { effort: "max" } });
  });

  it("a forced tool becomes auto + strict + a system instruction (the models reject forced tool_choice)", () => {
    const p = toCreateParams({ ...baseReq, tools: [emitTool], toolChoice: { name: "emit_fit" } }, "claude-sonnet-5-5", "fast");
    expect(p.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(p.tools?.[0]).toMatchObject({ name: "emit_fit", strict: true });
    expect((p.tools?.[0] as Tool).input_schema.additionalProperties).toBe(false);
    expect(p.system).toContain("You score funders.");
    expect(p.system).toContain("`emit_fit` tool exactly once");
    expect(JSON.stringify(p)).not.toContain('"type":"tool"');
    expect(JSON.stringify(p)).not.toContain('"type":"any"');
    // The caller's schema object is not mutated.
    expect(emitTool.input_schema.additionalProperties).toBeUndefined();
    expect(emitTool.strict).toBeUndefined();
  });

  it("'any' names every tool; 'none' and 'auto' pass through", () => {
    expect(toCreateParams({ ...baseReq, tools: [emitTool], toolChoice: "any" }, "claude-opus-5-5", "deep").system).toContain("exactly one of the provided tools (`emit_fit`)");
    expect(toCreateParams({ ...baseReq, tools: [emitTool], toolChoice: "none" }, "claude-opus-5-5", "deep").tool_choice).toEqual({ type: "none" });
    const auto = toCreateParams({ ...baseReq, tools: [emitTool] }, "claude-opus-5-5", "deep");
    expect(auto.tool_choice).toEqual({ type: "auto" });
    expect(auto.tools?.[0]).toBe(emitTool);
  });

  it("temperature only reaches models that still accept it; effort only models that support it", () => {
    expect(modelAcceptsTemperature("claude-sonnet-5-5")).toBe(false);
    expect(modelAcceptsTemperature("claude-opus-5-5")).toBe(false);
    expect(modelAcceptsTemperature("claude-sonnet-4-6")).toBe(true);
    expect(modelAcceptsTemperature("claude-haiku-4-5")).toBe(true);
    expect(toCreateParams({ ...baseReq, temperature: 0 }, "claude-sonnet-5-5", "fast").temperature).toBeUndefined();
    expect(toCreateParams({ ...baseReq, temperature: 0 }, "claude-sonnet-4-6", "fast").temperature).toBe(0);
    expect(effortFor("claude-haiku-4-5", "low")).toBeNull();
    expect(effortFor("claude-opus-4-5", "max")).toBe("high");
    expect(effortFor("claude-opus-5-5", "xhigh")).toBe("xhigh");
    expect(toCreateParams(baseReq, "claude-haiku-4-5", "fast").output_config).toBeUndefined();
  });

  it("passes an opaque user id as metadata", () => {
    expect(toCreateParams({ ...baseReq, userId: "u-123" }, "claude-sonnet-5-5", "fast").metadata).toEqual({ user_id: "u-123" });
  });
});

function message(over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: "Hello", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: null, cache_read_input_tokens: 100, cache_creation: null, server_tool_use: null, service_tier: "standard", inference_geo: null, output_tokens_details: null },
    ...over,
  } as Anthropic.Message;
}

describe("fromMessage", () => {
  it("collects text, the first tool_use input and usage", () => {
    const res = fromMessage(
      message({
        content: [
          { type: "text", text: "A", citations: null },
          { type: "tool_use", id: "t1", name: "emit_fit", input: { score: 7 }, caller: { type: "direct" } } as never,
          { type: "text", text: "B", citations: null },
        ],
        stop_reason: "tool_use",
      }),
    );
    expect(res).toMatchObject({ text: "AB", toolName: "emit_fit", toolInput: { score: 7 }, stopReason: "tool_use", mock: false });
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30, model: "claude-sonnet-5-5", cacheReadInputTokens: 100, cacheCreationInputTokens: undefined });
  });
});

describe("mock client", () => {
  const mock = makeAiClient("mock");

  it("is deterministic and token-free", async () => {
    const req = { ...baseReq, tools: [emitTool], toolChoice: { name: "emit_fit" } };
    const a = await mock.fast(req);
    const b = await mock.fast(req);
    expect(a).toEqual(b);
    expect(a.mock).toBe(true);
    expect(a.usage).toEqual({ inputTokens: 0, outputTokens: 0, model: "mock" });
    expect(a.stopReason).toBe("tool_use");
    expect(a.toolName).toBe("emit_fit");
    expect(mockResponse(req, "fast")).toEqual(a);
    // The deep tier and a different prompt give different (but still deterministic) output.
    const c = await mock.deep(req);
    expect(c).toEqual(await mock.deep(req));
    const d = await mock.fast({ ...req, messages: [{ role: "user", content: "Different funder." }] });
    expect(JSON.stringify(d.toolInput)).not.toBe(JSON.stringify(a.toolInput));
  });

  it("derives tool input from the schema: required keys, enums, bounds, arrays", async () => {
    const res = await mock.fast({ ...baseReq, tools: [emitTool], toolChoice: "any" });
    const input = res.toolInput as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(expect.arrayContaining(["score", "rating", "summary", "reasons"]));
    expect(Number.isInteger(input.score)).toBe(true);
    expect(input.score as number).toBeGreaterThanOrEqual(0);
    expect(input.score as number).toBeLessThanOrEqual(100);
    expect(["strong", "possible", "weak"]).toContain(input.rating);
    expect((input.summary as string).length).toBeLessThanOrEqual(40);
    const reasons = input.reasons as Array<Record<string, unknown>>;
    expect(reasons.length).toBeGreaterThanOrEqual(1);
    expect(reasons.length).toBeLessThanOrEqual(3);
    expect(typeof reasons[0].statement).toBe("string");
    expect(Array.isArray(reasons[0].evidence_ids)).toBe(true);
  });

  it("answers in text when there are no tools, and streams the same text", async () => {
    const res = await mock.fast(baseReq);
    expect(res.stopReason).toBe("end_turn");
    expect(res.toolInput).toBeUndefined();
    expect(res.text).toContain("[mock fast");
    expect(res.text).toContain("Score the Example Foundation");
    const deltas: string[] = [];
    const streamed = await mock.stream(baseReq, (d) => deltas.push(d));
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(streamed.text);
    expect(streamed.text).toBe(res.text);
  });

  it("respects toolChoice none", async () => {
    const res = await mock.fast({ ...baseReq, tools: [emitTool], toolChoice: "none" });
    expect(res.toolInput).toBeUndefined();
  });
});

describe("disabled client", () => {
  it("throws AiDisabledError on every call", async () => {
    const c = makeAiClient("disabled");
    await expect(c.fast(baseReq)).rejects.toBeInstanceOf(AiDisabledError);
    await expect(c.deep(baseReq)).rejects.toBeInstanceOf(AiDisabledError);
    await expect(c.stream(baseReq, () => undefined)).rejects.toBeInstanceOf(AiDisabledError);
  });
});

describe("live client (fake SDK)", () => {
  function sdk(responses: Anthropic.Message[], streamText = "") {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    let i = 0;
    const create = vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => {
      calls.push(params);
      return responses[Math.min(i++, responses.length - 1)];
    });
    const stream = vi.fn((params: Anthropic.MessageCreateParamsNonStreaming) => {
      calls.push(params);
      const listeners: Array<(d: string) => void> = [];
      return {
        on: (event: string, fn: (d: string) => void) => {
          if (event === "text") listeners.push(fn);
        },
        finalMessage: async () => {
          for (const l of listeners) for (const w of streamText.split(" ")) l(`${w} `);
          return responses[0];
        },
      };
    });
    return { client: { messages: { create, stream } } as unknown as Anthropic, create, stream, calls };
  }

  const toolMsg = message({
    content: [{ type: "tool_use", id: "t1", name: "emit_fit", input: { score: 55 }, caller: { type: "direct" } } as never],
    stop_reason: "tool_use",
    usage: { ...message().usage, input_tokens: 10, output_tokens: 5 },
  });

  it("uses the configured models per tier and returns the tool input", async () => {
    const { client, create, calls } = sdk([toolMsg]);
    const live = makeAiClient("live", { sdk: client, env: { AI_MODEL_FAST: "fast-model", AI_MODEL_DEEP: "deep-model" } });
    const res = await live.fast({ ...baseReq, tools: [emitTool], toolChoice: { name: "emit_fit" } });
    expect(res.toolInput).toEqual({ score: 55 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ model: "fast-model", tool_choice: { type: "auto", disable_parallel_tool_use: true } });
    const second = sdk([message()]);
    await makeAiClient("live", { sdk: second.client, env: { AI_MODEL_DEEP: "deep-model" } }).deep(baseReq);
    expect(second.calls[0]).toMatchObject({ model: "deep-model" });
  });

  it("nudges once when a required tool call is missing and sums the usage", async () => {
    const { client, create, calls } = sdk([message(), toolMsg]);
    const res = await makeAiClient("live", { sdk: client }).fast({ ...baseReq, tools: [emitTool], toolChoice: { name: "emit_fit" } });
    expect(create).toHaveBeenCalledTimes(2);
    const second = calls[1];
    expect(second.messages).toHaveLength(3);
    expect(second.messages[1].role).toBe("assistant");
    expect(second.messages[2]).toMatchObject({ role: "user" });
    expect(res.toolInput).toEqual({ score: 55 });
    expect(res.usage).toMatchObject({ inputTokens: 130, outputTokens: 35, model: "claude-sonnet-5-5" });
  });

  it("gives up after the nudge with AiNoToolCallError carrying usage", async () => {
    const { client } = sdk([message(), message()]);
    const err = (await makeAiClient("live", { sdk: client }).fast({ ...baseReq, tools: [emitTool], toolChoice: { name: "emit_fit" } }).catch((e: unknown) => e)) as AiNoToolCallError;
    expect(err).toBeInstanceOf(AiNoToolCallError);
    expect(err.usage).toMatchObject({ inputTokens: 240, outputTokens: 60 });
  });

  it("turns a refusal into AiRefusedError with usage and category", async () => {
    const refused = message({ stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } as never, content: [] });
    const { client, create } = sdk([refused]);
    const err = (await makeAiClient("live", { sdk: client }).deep(baseReq).catch((e: unknown) => e)) as AiRefusedError;
    expect(err).toBeInstanceOf(AiRefusedError);
    expect(err.message).toContain("cyber");
    expect(err.usage).toMatchObject({ inputTokens: 120 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("streams text deltas and returns the final message", async () => {
    const { client, stream, calls } = sdk([message({ content: [{ type: "text", text: "Hello world", citations: null }] })], "Hello world");
    const deltas: string[] = [];
    const res = await makeAiClient("live", { sdk: client }).stream({ ...baseReq, tier: "deep" }, (d) => deltas.push(d));
    expect(deltas.join("").trim()).toBe("Hello world");
    expect(res.text).toBe("Hello world");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5" });
  });
});

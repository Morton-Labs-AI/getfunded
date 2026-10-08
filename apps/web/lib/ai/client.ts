import "server-only";
/**
 * The ONLY module that imports `@anthropic-ai/sdk`. Everything else reaches a
 * model through `meter()` in lib/billing/meter.ts, which hands feature code an
 * `AiClient` and records credits and tokens in `getfunded.usage_ledger`.
 * `tests/unit/ai/sdk-boundary.test.ts` scans lib/ and app/ to keep it that way.
 *
 * Modes (see `aiMode()`):
 *  - live:     Anthropic Messages API; AI_MODEL_FAST / AI_MODEL_DEEP pick the models.
 *  - mock:     AI_MODE=mock. Deterministic, token-free responses derived from a hash of
 *              the request, so dev and e2e runs never spend money. Usage is {0, 0}.
 *  - disabled: AI_ENABLED=false. Every call throws AiDisabledError.
 *
 * Tool calls: the current models (Sonnet 5.5, Opus 5.5) return HTTP 400 for a
 * forced `tool_choice` (`any` / `tool`). A request with `toolChoice: { name }`
 * or `"any"` is therefore sent as `tool_choice: auto` with `strict: true` on the
 * tools and a system instruction naming the tool, and retried once with a nudge
 * when no tool_use block comes back. Callers still validate `toolInput` with zod.
 */
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  AiDisabledError,
  AiNoToolCallError,
  AiRefusedError,
  addUsage,
  type AiClient,
  type AiMode,
  type AiRequest,
  type AiResponse,
  type AiTier,
  type Effort,
  type Usage,
} from "./types";

export type MessageParam = Anthropic.MessageParam;
export type Tool = Anthropic.Tool;
export type StopReason = Anthropic.StopReason;

export const DEFAULT_FAST_MODEL = "claude-sonnet-5-5";
export const DEFAULT_DEEP_MODEL = "claude-opus-5-5";
export const MOCK_MODEL = "mock";

type Env = Record<string, string | undefined>;

function isFalse(v: string | undefined): boolean {
  const s = v?.trim().toLowerCase();
  return s === "false" || s === "0" || s === "no" || s === "off";
}

/** Resolve the mode from the environment. AI_MODE=mock wins over AI_ENABLED. */
export function aiMode(env: Env = process.env): AiMode {
  if (env.AI_MODE?.trim().toLowerCase() === "mock") return "mock";
  if (isFalse(env.AI_ENABLED)) return "disabled";
  return "live";
}

export type Models = Record<AiTier, string>;

export function modelsFromEnv(env: Env = process.env): Models {
  return {
    fast: env.AI_MODEL_FAST?.trim() || DEFAULT_FAST_MODEL,
    deep: env.AI_MODEL_DEEP?.trim() || DEFAULT_DEEP_MODEL,
  };
}

const TIER_DEFAULTS: Record<AiTier, { maxTokens: number; effort: Effort }> = {
  fast: { maxTokens: 8_192, effort: "low" },
  deep: { maxTokens: 16_000, effort: "high" },
};

/** Sampling parameters were removed from Opus 4.7+ and Sonnet 5+; only 4.6-era and older models accept them. */
export function modelAcceptsTemperature(model: string): boolean {
  return /claude-(opus|sonnet|haiku)-(3|4-[0-6])\b/.test(model) || /claude-3/.test(model);
}

/** `output_config.effort` is rejected by Haiku 4.5 and Sonnet 4.5; Opus 4.5 knows only low/medium/high. */
export function effortFor(model: string, requested: Effort): Effort | null {
  if (/claude-(haiku-4-5|sonnet-4-5)\b/.test(model)) return null;
  if (/claude-opus-4-5\b/.test(model) && (requested === "xhigh" || requested === "max")) return "high";
  return requested;
}

export function isForcedToolChoice(choice: AiRequest["toolChoice"]): boolean {
  return choice === "any" || (typeof choice === "object" && choice !== null);
}

function forcedToolName(req: AiRequest): string | null {
  if (typeof req.toolChoice === "object" && req.toolChoice !== null) return req.toolChoice.name;
  if (req.toolChoice === "any") return req.tools?.[0]?.name ?? null;
  return null;
}

function toolInstruction(req: AiRequest): string {
  if (typeof req.toolChoice === "object" && req.toolChoice !== null) {
    return `Respond by calling the \`${req.toolChoice.name}\` tool exactly once with a complete, schema-valid input. Do not answer in prose.`;
  }
  const names = (req.tools ?? []).map((t) => `\`${t.name}\``).join(", ");
  return `Respond by calling exactly one of the provided tools (${names}) with a complete, schema-valid input. Do not answer in prose.`;
}

function strictTool(tool: Tool): Tool {
  const schema = tool.input_schema;
  return {
    ...tool,
    strict: true,
    input_schema: {
      ...schema,
      additionalProperties: schema.additionalProperties ?? false,
    },
  };
}

/**
 * Translate an `AiRequest` into Messages API parameters for one model.
 * Exported for tests; feature code never calls it.
 */
export function toCreateParams(
  req: AiRequest,
  model: string,
  tier: AiTier,
): Anthropic.MessageCreateParamsNonStreaming {
  const forced = isForcedToolChoice(req.toolChoice);
  const system = forced ? `${req.system.trimEnd()}\n\n${toolInstruction(req)}` : req.system;
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: req.maxTokens ?? TIER_DEFAULTS[tier].maxTokens,
    system,
    messages: req.messages,
  };
  const effort = effortFor(model, req.effort ?? TIER_DEFAULTS[tier].effort);
  if (effort) params.output_config = { effort };
  if (req.tools && req.tools.length > 0) {
    params.tools = forced ? req.tools.map(strictTool) : req.tools;
    if (req.toolChoice === "none") params.tool_choice = { type: "none" };
    else if (forced) params.tool_choice = { type: "auto", disable_parallel_tool_use: true };
    else params.tool_choice = { type: "auto" };
  }
  if (req.temperature !== undefined && modelAcceptsTemperature(model)) params.temperature = req.temperature;
  if (req.userId) params.metadata = { user_id: req.userId };
  return params;
}

function usageOf(msg: Anthropic.Message): Usage {
  return {
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    model: msg.model,
    cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? undefined,
    cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? undefined,
  };
}

/** Collapse a Message into the small shape feature code consumes. */
export function fromMessage(msg: Anthropic.Message): AiResponse {
  let text = "";
  let toolInput: unknown;
  let toolName: string | undefined;
  for (const block of msg.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use" && toolInput === undefined) {
      toolInput = block.input;
      toolName = block.name;
    }
  }
  return {
    text,
    toolInput,
    toolName,
    stopReason: msg.stop_reason ?? "end_turn",
    usage: usageOf(msg),
    mock: false,
  };
}

function refusalMessage(msg: Anthropic.Message): string {
  const d = msg.stop_details;
  const category = d && "category" in d && d.category ? ` (${d.category})` : "";
  return `The model declined this request${category}.`;
}

class LiveClient implements AiClient {
  readonly mode = "live" as const;
  constructor(
    private readonly sdk: Anthropic,
    private readonly models: Models,
  ) {}

  fast(req: AiRequest): Promise<AiResponse> {
    return this.call(req, "fast");
  }

  deep(req: AiRequest): Promise<AiResponse> {
    return this.call(req, "deep");
  }

  private async call(req: AiRequest, tier: AiTier): Promise<AiResponse> {
    const model = this.models[tier];
    const params = toCreateParams(req, model, tier);
    const first = await this.sdk.messages.create(params);
    let res = fromMessage(first);
    if (res.stopReason === "refusal") throw new AiRefusedError(refusalMessage(first), res.usage);
    const wanted = forcedToolName(req);
    if (wanted && res.toolInput === undefined && res.stopReason !== "max_tokens") {
      // One nudge. The assistant turn is echoed back so the model sees what it wrote.
      const assistant: MessageParam = {
        role: "assistant",
        content: first.content.length > 0 ? first.content : [{ type: "text", text: "(no tool call)" }],
      };
      const second = await this.sdk.messages.create({
        ...params,
        messages: [
          ...params.messages,
          assistant,
          { role: "user", content: `Call the \`${wanted}\` tool now with a complete input. No prose.` },
        ],
      });
      const retry = fromMessage(second);
      retry.usage = addUsage(res.usage, retry.usage);
      res = retry;
      if (res.stopReason === "refusal") throw new AiRefusedError(refusalMessage(second), res.usage);
    }
    if (wanted && res.toolInput === undefined) throw new AiNoToolCallError(wanted, res.usage);
    return res;
  }

  async stream(req: AiRequest, onDelta: (delta: string) => void): Promise<AiResponse> {
    const tier = req.tier ?? "fast";
    const model = this.models[tier];
    const params = toCreateParams(req, model, tier);
    const stream = this.sdk.messages.stream(params);
    stream.on("text", (delta) => onDelta(delta));
    const msg = await stream.finalMessage();
    const res = fromMessage(msg);
    if (res.stopReason === "refusal") throw new AiRefusedError(refusalMessage(msg), res.usage);
    const wanted = forcedToolName(req);
    if (wanted && res.toolInput === undefined) throw new AiNoToolCallError(wanted, res.usage);
    return res;
  }
}

/* ------------------------------------------------------------------------ */
/* Mock client                                                               */
/* ------------------------------------------------------------------------ */

/** Small deterministic PRNG (xorshift32) seeded from a hash. */
class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 0x100000000;
  }
  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }
  bool(): boolean {
    return this.next() < 0.5;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

type JsonSchema = Record<string, unknown>;

function asSchema(v: unknown): JsonSchema | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonSchema) : null;
}

/** Generate a schema-shaped value: required keys always, optional keys by coin flip. */
export function mockValueFor(schemaIn: unknown, rng: Rng, path = "value", depth = 0): unknown {
  const schema = asSchema(schemaIn);
  if (!schema || depth > 6) return null;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return rng.pick(schema.enum as unknown[]);
  if (schema.const !== undefined) return schema.const;
  const variants = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
  if (Array.isArray(variants) && variants.length > 0) return mockValueFor(variants[0], rng, path, depth + 1);
  const type = Array.isArray(schema.type) ? (schema.type as unknown[])[0] : schema.type;
  switch (type) {
    case "string": {
      if (schema.format === "date") return "2026-01-15";
      if (schema.format === "date-time") return "2026-01-15T12:00:00Z";
      if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000000";
      if (schema.format === "uri" || schema.format === "url") return `https://example.org/${path}`;
      const text = `${path} (mock ${rng.int(0xffff).toString(16).padStart(4, "0")})`;
      const max = typeof schema.maxLength === "number" ? schema.maxLength : undefined;
      return max !== undefined && text.length > max ? text.slice(0, max) : text;
    }
    case "integer":
    case "number": {
      const min = typeof schema.minimum === "number" ? schema.minimum : 0;
      const max = typeof schema.maximum === "number" ? schema.maximum : min + 100;
      const n = min + rng.next() * (max - min);
      return type === "integer" ? Math.round(n) : Math.round(n * 100) / 100;
    }
    case "boolean":
      return rng.bool();
    case "null":
      return null;
    case "array": {
      const minItems = typeof schema.minItems === "number" ? schema.minItems : 1;
      const maxItems = typeof schema.maxItems === "number" ? schema.maxItems : Math.max(minItems, 2);
      const n = Math.min(maxItems, Math.max(minItems, 1 + rng.int(2)));
      return Array.from({ length: n }, (_, i) => mockValueFor(schema.items, rng, `${path}[${i}]`, depth + 1));
    }
    case "object":
    default: {
      const props = asSchema(schema.properties);
      if (!props) return type === "object" ? {} : null;
      const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(props)) {
        if (required.has(key) || rng.bool()) out[key] = mockValueFor(sub, rng, key, depth + 1);
      }
      return out;
    }
  }
}

function lastUserText(messages: MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    for (const block of m.content) if (block.type === "text") return block.text;
  }
  return "";
}

export function mockSeed(req: AiRequest, tier: AiTier): string {
  const canonical = JSON.stringify({
    tier,
    system: req.system,
    messages: req.messages,
    tools: (req.tools ?? []).map((t) => t.name),
    toolChoice: req.toolChoice ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Deterministic token-free response: same request, same output. Exported for tests. */
export function mockResponse(req: AiRequest, tier: AiTier): AiResponse {
  const seed = mockSeed(req, tier);
  const rng = new Rng(Number.parseInt(seed.slice(0, 8), 16));
  const prompt = lastUserText(req.messages).replace(/\s+/g, " ").trim().slice(0, 160);
  const text = `[mock ${tier} ${seed.slice(0, 8)}] ${prompt || "No prompt."}`;
  const tools = req.tools ?? [];
  const wantsTool = tools.length > 0 && req.toolChoice !== "none";
  if (!wantsTool) {
    return { text, stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0, model: MOCK_MODEL }, mock: true };
  }
  const name = forcedToolName(req) ?? tools[0].name;
  const tool = tools.find((t) => t.name === name) ?? tools[0];
  return {
    text: "",
    toolName: tool.name,
    toolInput: mockValueFor(tool.input_schema, rng, tool.name),
    stopReason: "tool_use",
    usage: { inputTokens: 0, outputTokens: 0, model: MOCK_MODEL },
    mock: true,
  };
}

class MockClient implements AiClient {
  readonly mode = "mock" as const;
  async fast(req: AiRequest): Promise<AiResponse> {
    return mockResponse(req, "fast");
  }
  async deep(req: AiRequest): Promise<AiResponse> {
    return mockResponse(req, "deep");
  }
  async stream(req: AiRequest, onDelta: (delta: string) => void): Promise<AiResponse> {
    const res = mockResponse(req, req.tier ?? "fast");
    for (const word of res.text.split(/(?<=\s)/)) {
      onDelta(word);
      await Promise.resolve();
    }
    return res;
  }
}

class DisabledClient implements AiClient {
  readonly mode = "disabled" as const;
  private refuse(): never {
    throw new AiDisabledError("AI is turned off for this deployment (AI_ENABLED=false).");
  }
  async fast(): Promise<AiResponse> {
    return this.refuse();
  }
  async deep(): Promise<AiResponse> {
    return this.refuse();
  }
  async stream(): Promise<AiResponse> {
    return this.refuse();
  }
}

/* ------------------------------------------------------------------------ */
/* Construction                                                              */
/* ------------------------------------------------------------------------ */

function newSdk(env: Env): Anthropic {
  const workspace = env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    timeout: 10 * 60 * 1000,
    maxRetries: 2,
    defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
  });
}

export type MakeAiClientOptions = { env?: Env; sdk?: Anthropic; models?: Partial<Models> };

/** Build a client for a mode. Defaults to the mode the environment selects. */
export function makeAiClient(mode?: AiMode, opts: MakeAiClientOptions = {}): AiClient {
  const env = opts.env ?? process.env;
  const resolved = mode ?? aiMode(env);
  switch (resolved) {
    case "mock":
      return new MockClient();
    case "disabled":
      return new DisabledClient();
    case "live":
      return new LiveClient(opts.sdk ?? newSdk(env), { ...modelsFromEnv(env), ...opts.models });
  }
}

let cached: { key: string; client: AiClient } | null = null;

/** The process-wide client for the current environment (rebuilt when env changes). */
export function getAiClient(env: Env = process.env): AiClient {
  const models = modelsFromEnv(env);
  const key = [aiMode(env), models.fast, models.deep, env.ANTHROPIC_API_KEY ? "k" : "-", env.ANTHROPIC_WORKSPACE_ID ?? ""].join("|");
  if (cached?.key !== key) cached = { key, client: makeAiClient(undefined, { env }) };
  return cached.client;
}

export function resetAiClientForTests(): void {
  cached = null;
}

/**
 * The AI client contract and its typed errors.
 *
 * Nothing here imports `@anthropic-ai/sdk`; the SDK types that leak into the
 * contract (`MessageParam`, `Tool`, `StopReason`) are re-exported from
 * `lib/ai/client.ts`, the only module allowed to import the SDK. Feature code
 * imports this file for types and `lib/billing/meter.ts` for calls.
 */
import type { MessageParam, StopReason, Tool } from "./client";

export type { MessageParam, StopReason, Tool };

export type AiMode = "live" | "mock" | "disabled";

/** Which model tier a request wants. `fast` = AI_MODEL_FAST, `deep` = AI_MODEL_DEEP. */
export type AiTier = "fast" | "deep";

/**
 * `any` and `{ name }` ask for a tool call. The current models reject a forced
 * `tool_choice`, so the client translates these into `auto` plus a strict
 * schema plus a system instruction, and retries once when no call comes back.
 */
export type ToolChoice = "auto" | "any" | "none" | { name: string };

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AiRequest = {
  system: string;
  messages: MessageParam[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  maxTokens?: number;
  /** Only forwarded to models that still accept sampling parameters (4.6 and earlier). */
  temperature?: number;
  /** Thinking depth. Defaults: fast → low, deep → high. */
  effort?: Effort;
  /** Opaque user id for Anthropic's abuse detection (never an email). */
  userId?: string;
  /** For `stream()`: which model tier to stream from. Default fast. */
  tier?: AiTier;
};

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  model: string;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
};

export type AiStopReason = StopReason | "mock";

export type AiResponse = {
  /** Concatenated text blocks ("" when the model only called a tool). */
  text: string;
  /** Parsed input of the first tool_use block, when there is one. Validate it with zod before use. */
  toolInput?: unknown;
  toolName?: string;
  stopReason: AiStopReason;
  usage: Usage;
  /** True when produced by the AI_MODE=mock client. Never store mock output as real analysis. */
  mock: boolean;
};

export type AiClient = {
  readonly mode: AiMode;
  fast(req: AiRequest): Promise<AiResponse>;
  deep(req: AiRequest): Promise<AiResponse>;
  stream(req: AiRequest, onDelta: (delta: string) => void): Promise<AiResponse>;
};

export class AiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiError";
    this.code = code;
    this.status = status;
  }
  toJSON() {
    return { error: this.code, message: this.message };
  }
}

/** Kill switch: `AI_ENABLED=false` or the `ai_enabled` flag is off. */
export class AiDisabledError extends AiError {
  constructor(message = "AI features are turned off right now.") {
    super("ai_disabled", 503, message);
    this.name = "AiDisabledError";
  }
}

/** The model declined the request (`stop_reason: "refusal"`). Carries the usage so the ledger can record tokens. */
export class AiRefusedError extends AiError {
  readonly usage: Usage | null;
  constructor(message = "The model declined this request.", usage: Usage | null = null) {
    super("ai_refused", 422, message);
    this.name = "AiRefusedError";
    this.usage = usage;
  }
}

/** A tool call was required but the model answered in prose twice. */
export class AiNoToolCallError extends AiError {
  readonly usage: Usage | null;
  constructor(toolName: string, usage: Usage | null = null) {
    super("ai_no_tool_call", 502, `The model did not call the ${toolName} tool.`);
    this.name = "AiNoToolCallError";
    this.usage = usage;
  }
}

/** Pull a `Usage` off an error when the client attached one (refusal, missing tool call). */
export function usageFromError(err: unknown): Usage | null {
  if (err && typeof err === "object" && "usage" in err) {
    const u = (err as { usage?: unknown }).usage;
    if (u && typeof u === "object" && "inputTokens" in u && "outputTokens" in u) return u as Usage;
  }
  return null;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    model: b.model || a.model,
    cacheReadInputTokens: (a.cacheReadInputTokens ?? 0) + (b.cacheReadInputTokens ?? 0),
    cacheCreationInputTokens: (a.cacheCreationInputTokens ?? 0) + (b.cacheCreationInputTokens ?? 0),
  };
}

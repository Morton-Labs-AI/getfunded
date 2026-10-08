/**
 * Turn an "Ask the analyst" run into an HTTP response. Pure (no server
 * imports), so the framing is unit-tested with a fake runner.
 *
 * Two outcomes:
 *   - the run throws BEFORE its first event (quota, kill switch, not
 *     configured, bad input): the caller gets an ordinary JSON error with the
 *     right status, which a fetch() caller can read without parsing a stream;
 *   - the run has started emitting: the response is `text/event-stream`, and a
 *     later failure arrives as an `error` event followed by `done`, so the
 *     chat shows what happened instead of a dead connection.
 *
 * A client that goes away stops receiving frames; the model call itself runs
 * to completion so the ledger row is settled either way. `askStream()` hands
 * the route that completion promise (`settled`) so it can keep the function
 * alive with `after()` from next/server: a reservation must never be left
 * 'reserved' because the browser closed the tab.
 */
import { aiErrorPayload, aiErrorToResponse, internalErrorResponse } from "./http";
import { sseFrame, sseHeaders, type AskEvent } from "./sse";

export type Emit = (event: AskEvent) => void;
export type AskRunner = (emit: Emit) => Promise<void>;

export type AskStreamOptions = {
  /** The request's abort signal: stops enqueuing when the browser disconnects. */
  signal?: AbortSignal;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

/** The `error` event for a failure that happened after the stream had started. */
export function errorEventFor(err: unknown): Extract<AskEvent, { type: "error" }> {
  const payload = aiErrorPayload(err);
  if (payload) {
    const e = payload.body.error;
    const event: Extract<AskEvent, { type: "error" }> = {
      type: "error",
      code: String(e.code ?? "error"),
      message: String(e.message ?? "Something went wrong."),
      status: payload.status,
    };
    if (typeof e.upgradeUrl === "string") event.upgradeUrl = e.upgradeUrl;
    return event;
  }
  return { type: "error", code: "internal_error", message: "Something went wrong on our side. Please try again.", status: 500 };
}

export type AskStreamResult = {
  response: Response;
  /** Resolves (never rejects) once the run has finished, including after the client went away. */
  settled: Promise<void>;
};

/** The response only; see `askStream()` when the caller must wait for the run. */
export async function askStreamResponse(run: AskRunner, opts: AskStreamOptions = {}): Promise<Response> {
  return (await askStream(run, opts)).response;
}

export async function askStream(run: AskRunner, opts: AskStreamOptions = {}): Promise<AskStreamResult> {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let started = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
    },
  });
  opts.signal?.addEventListener("abort", () => {
    closed = true;
  });

  const push = (event: AskEvent) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(sseFrame(event)));
    } catch {
      closed = true;
    }
  };
  const finish = () => {
    if (closed || !controller) return;
    closed = true;
    try {
      controller.close();
    } catch {
      /* already closed by the consumer */
    }
  };

  let resolveFirst: () => void = () => undefined;
  const first = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });

  const emit: Emit = (event) => {
    if (!started) {
      started = true;
      resolveFirst();
    }
    push(event);
  };

  type Outcome = { ok: true } | { ok: false; err: unknown; started: boolean };
  const running: Promise<Outcome> = run(emit).then(
    () => {
      // A run that never emitted still ends the stream cleanly.
      if (!started) push({ type: "done" });
      finish();
      return { ok: true } as const;
    },
    (err: unknown) => {
      const wasStarted = started;
      if (wasStarted) {
        (opts.log ?? defaultLog)("ask stream failed after start", describe(err));
        push(errorEventFor(err));
        push({ type: "done" });
        finish();
      }
      return { ok: false, err, started: wasStarted } as const;
    },
  );

  const settled: Promise<void> = running.then(
    () => undefined,
    () => undefined,
  );

  const outcome = await Promise.race([first.then(() => null), running]);
  if (outcome && !outcome.ok && !outcome.started) {
    finish();
    const res = aiErrorToResponse(outcome.err);
    if (res) return { response: res, settled };
    (opts.log ?? defaultLog)("ask failed before start", describe(outcome.err));
    return { response: internalErrorResponse(), settled };
  }
  return { response: new Response(stream, { headers: sseHeaders() }), settled };
}

function describe(err: unknown): Record<string, unknown> {
  return { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
}

function defaultLog(message: string, extra?: Record<string, unknown>) {
  console.error(`[api/ai/ask] ${message}`, extra ?? {});
}

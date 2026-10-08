import type { z } from "zod";

/** Anything shaped like process.env; tests pass a plain object. */
export type Env = Record<string, string | undefined>;

/**
 * Request security for Route Handlers and Server Actions that read raw
 * `Request`s: same-origin enforcement, bounded JSON bodies, client IP for rate
 * limiting, and one JSON error shape.
 *
 * Failures are thrown as `Response` objects so a handler can simply
 * `try { ... } catch (e) { if (e instanceof Response) return e; throw e; }`.
 */

/** `{ error: { code, message, ...extra } }` with `Cache-Control: no-store`. */
export function jsonError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { "cache-control": "no-store" } });
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).host.toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * The hosts a browser request may legitimately come from: `APP_URL` (the
 * canonical origin) plus the host this request was addressed to (so preview
 * deployments and local development work without a per-deploy APP_URL).
 */
export function allowedHosts(req: Request, env: Env = process.env): Set<string> {
  const hosts = new Set<string>();
  const appHost = hostOf(env.APP_URL);
  if (appHost) hosts.add(appHost);
  const requestHost = hostOf(req.url);
  if (requestHost) hosts.add(requestHost);
  const hostHeader = req.headers.get("host")?.trim().toLowerCase();
  if (hostHeader) hosts.add(hostHeader);
  return hosts;
}

/** Non-throwing form of `assertSameOrigin`. */
export function isSameOrigin(req: Request, env: Env = process.env): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  const sourceHost = hostOf(req.headers.get("origin") ?? req.headers.get("referer"));
  if (!sourceHost) return false;
  return allowedHosts(req, env).has(sourceHost);
}

/**
 * Require a same-origin browser request. Compares the `Origin` header (or
 * `Referer` when Origin is absent) against `APP_URL` and the request host, and
 * refuses `Sec-Fetch-Site: cross-site`. A request with neither header is
 * refused: every modern browser sends Origin on a state-changing request, so
 * its absence means a script or a very old client. Throws a 403 `Response`.
 */
export function assertSameOrigin(req: Request, env: Env = process.env): void {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw jsonError(403, "cross_site", "Cross-site requests are not allowed.");
  }
  const source = req.headers.get("origin") ?? req.headers.get("referer");
  const sourceHost = hostOf(source);
  if (!sourceHost) {
    throw jsonError(403, "missing_origin", "This request must come from the GetFunded site.");
  }
  if (!allowedHosts(req, env).has(sourceHost)) {
    throw jsonError(403, "bad_origin", "This request came from another site and was refused.");
  }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Read a JSON body of at most `maxBytes`, parse it with `schema`, return the
 * typed value. Throws a `Response`: 415 for a non-JSON content type, 413 when
 * the declared or streamed size exceeds the cap, 400 for invalid JSON or a
 * schema mismatch (with `issues`).
 */
export async function boundedJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 64_000): Promise<T> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw jsonError(415, "unsupported_media_type", "Send JSON with a Content-Type of application/json.");
  }

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw jsonError(413, "payload_too_large", `The request body must be ${maxBytes} bytes or smaller.`);
  }
  if (!req.body) {
    throw jsonError(400, "empty_body", "A JSON body is required.");
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw jsonError(413, "payload_too_large", `The request body must be ${maxBytes} bytes or smaller.`);
    }
    chunks.push(value);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(concat(chunks, size)));
  } catch {
    throw jsonError(400, "invalid_json", "The request body is not valid JSON.");
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw jsonError(400, "invalid_body", "The request body did not match what this endpoint expects.", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

const IP_RE = /^[0-9a-f.:]+$/i;

function normalizeIp(value: string): string | null {
  let ip = value.trim();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  if (ip.length === 0 || ip.length > 64 || !IP_RE.test(ip)) return null;
  return ip.toLowerCase();
}

/**
 * True when the forwarding headers can be believed: on Vercel (the platform
 * sets them and strips what the client sent) or when the operator has set
 * `TRUST_PROXY=true` behind their own reverse proxy. Anywhere else a client
 * can write `X-Forwarded-For` itself, which would let it pick its own rate
 * limit bucket, so the headers are ignored.
 */
export function trustsProxyHeaders(env: Env = process.env): boolean {
  const flag = env.TRUST_PROXY?.trim().toLowerCase();
  if (flag === "true" || flag === "1" || flag === "yes") return true;
  if (flag === "false" || flag === "0" || flag === "no") return false;
  return Boolean(env.VERCEL?.trim());
}

/**
 * The client address for rate limiting, or `"unknown"`. Only read from
 * `X-Forwarded-For` (right-most valid hop: the one the trusted proxy appended,
 * so a spoofed left-most entry is ignored) and then `X-Real-IP`, and only
 * when `trustsProxyHeaders()` says the deployment sits behind a proxy that
 * sets them. `"unknown"` is still a bucket key (callers share one bucket for
 * it), never a bypass. Only ever used as a bucket key, never as an identity.
 */
export function clientIp(req: Request, env: Env = process.env): string {
  if (!trustsProxyHeaders(env)) return "unknown";
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    for (let i = hops.length - 1; i >= 0; i--) {
      const ip = normalizeIp(hops[i] ?? "");
      if (ip) return ip;
    }
  }
  const real = req.headers.get("x-real-ip");
  if (real) {
    const ip = normalizeIp(real);
    if (ip) return ip;
  }
  return "unknown";
}

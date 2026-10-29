/**
 * How the eval suite reaches a deployment.
 *
 *   fetch   a public origin (https://getfunded.ai, http://localhost:3050)
 *   vercel  a protected preview (*.vercel.app): each request goes through
 *           `vercel curl`, which applies the project's own protection bypass,
 *           so no secret ever passes through this code. Run from apps/web
 *           (the linked directory).
 *
 * The x-eval-token header lifts the search rate limit on a deployment that
 * set EVAL_TOKEN; without it the client throttles itself under the public
 * limit (30 searches a minute per address).
 */
import { execFile } from "node:child_process";

export function chooseTransport(base, override) {
  if (override) return override;
  return /\.vercel\.app$/i.test(new URL(base).host) ? "vercel" : "fetch";
}

/** A token bucket on the client side: at most `perMinute` calls. */
export function throttle(perMinute) {
  if (!perMinute) return async () => {};
  const gap = 60_000 / perMinute;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

function viaVercel(base, pathAndQuery, headers, cwd, timeoutSec) {
  const args = ["curl", pathAndQuery, "--deployment", base, "--", "--silent", "--show-error", "--max-time", String(timeoutSec)];
  for (const [k, v] of Object.entries(headers)) args.push("--header", `${k}: ${v}`);
  args.push("--write-out", "\n__EVAL_STATUS__%{http_code} %{time_total}");
  return new Promise((resolve) => {
    execFile("vercel", args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: (timeoutSec + 30) * 1000 }, (err, stdout) => {
      const out = String(stdout ?? "");
      const at = out.lastIndexOf("\n__EVAL_STATUS__");
      if (at < 0) return resolve({ status: 0, ms: null, text: "", error: err ? String(err.message).slice(0, 300) : "no status line" });
      const [code, secs] = out.slice(at + "\n__EVAL_STATUS__".length).trim().split(/\s+/);
      resolve({ status: Number(code) || 0, ms: Math.round(Number(secs) * 1000), text: out.slice(0, at), error: null });
    });
  });
}

async function viaFetch(base, pathAndQuery, headers, timeoutSec) {
  const started = performance.now();
  try {
    const res = await fetch(new URL(pathAndQuery, base), { headers, signal: AbortSignal.timeout(timeoutSec * 1000) });
    const text = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - started), text, error: null };
  } catch (err) {
    return { status: 0, ms: Math.round(performance.now() - started), text: "", error: String(err?.message ?? err).slice(0, 300) };
  }
}

/**
 * GET `pathAndQuery` on `base`. Resolves { status, ms, json, error }; never
 * rejects, so one failed request is a data point, not a crashed run.
 */
export function makeClient({ base, transport, token, cwd, perMinute, timeoutSec = 90 }) {
  const wait = throttle(perMinute);
  const headers = token ? { "x-eval-token": token } : {};
  return async function get(pathAndQuery) {
    await wait();
    const r = transport === "vercel" ? await viaVercel(base, pathAndQuery, headers, cwd, timeoutSec) : await viaFetch(base, pathAndQuery, headers, timeoutSec);
    let json = null;
    if (r.text) {
      try {
        json = JSON.parse(r.text);
      } catch {
        if (!r.error) r.error = `not JSON (${r.text.slice(0, 80).replace(/\s+/g, " ")})`;
      }
    }
    return { status: r.status, ms: r.ms, json, error: r.error };
  };
}

/** Run `fn` over `items` with at most `n` in flight; results keep input order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

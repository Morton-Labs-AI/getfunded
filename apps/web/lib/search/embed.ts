import "server-only";

/**
 * Query-time embeddings for the meaning-based ("describe the work") search.
 * Voyage AI voyage-3.5 at 512 dimensions, which is what the corpus index was
 * built with. Returns null, never throws, when the key is missing or the
 * call fails: the caller then runs a keyword search and shows a notice.
 *
 * A small in-process LRU keeps repeated queries free. On a serverless host it
 * resets per cold start, which is fine.
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5";
export const EMBED_DIMS = 512;
const LRU_MAX = 500;
const TIMEOUT_MS = 8_000;

export type EmbedDeps = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

const cache = new Map<string, number[]>();

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when a Voyage key is configured. */
export function semanticEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VOYAGE_API_KEY && env.VOYAGE_API_KEY.trim().length > 0);
}

export async function embedQuery(text: string, deps: EmbedDeps = {}): Promise<number[] | null> {
  const env = deps.env ?? process.env;
  const key = env.VOYAGE_API_KEY?.trim();
  if (!key) return null;

  const normalized = normalize(text);
  if (!normalized) return null;
  const hit = cache.get(normalized);
  if (hit) {
    cache.delete(normalized);
    cache.set(normalized, hit);
    return hit;
  }

  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? ((m, e) => console.warn(`[embed] ${m}`, e ?? {}));
  try {
    const res = await doFetch(VOYAGE_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ input: [text], model: MODEL, input_type: "query", output_dimension: EMBED_DIMS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log("voyage refused", { status: res.status });
      return null;
    }
    const data = (await res.json()) as { data?: { embedding?: unknown }[] };
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIMS || !vec.every((n) => typeof n === "number" && Number.isFinite(n))) {
      log("voyage returned an unexpected shape", { length: Array.isArray(vec) ? vec.length : null });
      return null;
    }
    cache.set(normalized, vec);
    if (cache.size > LRU_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return vec;
  } catch (err) {
    log("voyage call failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** Test seam. */
export function resetEmbedCacheForTests(): void {
  cache.clear();
}

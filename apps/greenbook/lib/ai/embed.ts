/**
 * Query-time embeddings (Voyage, input_type='query', 512-dim) with an
 * in-memory LRU. Local-first app: per-process cache is correct; on a
 * serverless deploy this resets per cold start (documented, acceptable).
 */

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3.5";
const DIMS = 512;
const LRU_MAX = 500;

const cache = new Map<string, number[]>();

function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function embedQuery(text: string): Promise<number[]> {
  const key = normalizeQuery(text);
  const hit = cache.get(key);
  if (hit) {
    // LRU touch
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "VOYAGE_API_KEY is not set — semantic search is unavailable until it is."
    );
  }

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: MODEL,
      input_type: "query",
      output_dimension: DIMS,
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embedding failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  const vec = data.data[0].embedding;

  cache.set(key, vec);
  if (cache.size > LRU_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return vec;
}

/** pgvector/halfvec text literal. */
export function vecLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

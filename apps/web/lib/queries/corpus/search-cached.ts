import "server-only";

/**
 * The search page's cached search. A topic search ranks a pool of
 * candidates on every request, and paging or adding a chip asks the same
 * question again, so the page keeps each answer for a few minutes, keyed by
 * every parameter and the searcher's profile. The corpus changes daily at
 * most. A degraded answer (a timeout answered with keywords, semantic search
 * off) is kept for seconds only, so the next visitor gets a real one.
 *
 * The JSON API and the eval suite call searchFunders directly: they measure
 * the work, not the cache.
 */
import { cacheLife } from "next/cache";

import type { ProfileContext } from "@/lib/search/context";
import type { SearchParams } from "@/lib/search/params";

import { searchFunders } from "./search";
import type { SearchResult } from "./types";

export async function searchFundersCached(params: SearchParams, profile: ProfileContext | null): Promise<SearchResult> {
  "use cache";
  const result = await searchFunders(params, {}, { profile });
  const degraded = result.notices.some((n) => n === "semantic_timed_out" || n === "semantic_unavailable" || n === "timed_out");
  if (degraded) cacheLife("seconds");
  else cacheLife({ stale: 300, revalidate: 600, expire: 1800 });
  return result;
}

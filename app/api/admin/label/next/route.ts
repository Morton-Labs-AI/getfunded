import { adminRoute } from "@/lib/admin/db";
import { nextPair, pairDetail, progress, sessionSeed } from "@/lib/admin/labeling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve the next unlabeled pair, BLINDED: this payload never contains
 * match_probability, features, or any precision aggregate. The only counter
 * is non-unsure UI labels vs the fixed target.
 */
export async function GET(req: Request) {
  return adminRoute(req, async () => {
    const seed = sessionSeed();
    const pair = await nextPair(seed);
    const prog = await progress();
    if (!pair) return Response.json({ done: true, progress: prog });
    const detail = await pairDetail(pair.id_a, pair.id_b);
    return Response.json({ done: false, progress: prog, pair: detail });
  });
}

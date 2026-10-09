import { adminRoute } from "@/lib/admin/db";
import { progress, undoDecision } from "@/lib/admin/labeling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revert the last decision (client names the pair; only 'ui' rows deletable). */
export async function POST(req: Request) {
  return adminRoute(req, async () => {
    const body = await req.json().catch(() => null);
    const { id_a, id_b } = body ?? {};
    if (!id_a || !id_b) {
      return Response.json({ error: "id_a, id_b required" }, { status: 400 });
    }
    const { undone } = await undoDecision(String(id_a), String(id_b));
    return Response.json({ ok: true, undone, progress: await progress() });
  });
}

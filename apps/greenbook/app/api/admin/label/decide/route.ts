import { adminRoute } from "@/lib/admin/db";
import { progress, recordDecision } from "@/lib/admin/labeling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Write a decision; the response carries the post-write "model said" reveal. */
export async function POST(req: Request) {
  return adminRoute(req, async () => {
    const body = await req.json().catch(() => null);
    const { id_a, id_b, decision, notes } = body ?? {};
    if (!id_a || !id_b || !decision) {
      return Response.json({ error: "id_a, id_b, decision required" }, { status: 400 });
    }
    const { revealed } = await recordDecision(
      String(id_a), String(id_b), String(decision),
      notes ? String(notes).slice(0, 2000) : null
    );
    return Response.json({ ok: true, revealed, progress: await progress() });
  });
}

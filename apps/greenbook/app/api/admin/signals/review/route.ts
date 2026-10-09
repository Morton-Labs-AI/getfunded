import { adminRoute, adminSql } from "@/lib/admin/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The human gate for funder signals (corpus 0032 doctrine 2). Publish moves a
 * classified candidate to 'published' (it then appears on the profile and in
 * public.funder_signals, and every workspace app's sync picks it up); reject
 * keeps it for audit; reopen returns a rejected row to the queue. Never
 * touches 'superseded'. reviewed_by is always a human here.
 */
export async function POST(req: Request) {
  return adminRoute(req, async () => {
    const body = await req.json().catch(() => null);
    const id = Number(body?.id ?? 0);
    const status = String(body?.status ?? "");
    if (!id || !["published", "rejected", "candidate"].includes(status)) {
      return Response.json({ error: "id and status in published|rejected|candidate required" }, { status: 400 });
    }
    const reviewedBy = body?.reviewed_by ? String(body.reviewed_by).slice(0, 80) : "human:zach";
    const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;
    const rows = await adminSql`
      update internal.funder_signals
         set status = ${status}, reviewed_by = ${reviewedBy}, reviewed_at = now(),
             notes = coalesce(${notes}, notes)
       where id = ${id} and status <> 'superseded'
         and (${status} <> 'published' or extracted_at is not null)
       returning id, status`;
    if (rows.length === 0) {
      return Response.json(
        { error: "not updated: unknown id, superseded, or publishing a row that has not been classified yet" },
        { status: 409 }
      );
    }
    return Response.json({ ok: true, id: Number(rows[0].id), status: rows[0].status });
  });
}

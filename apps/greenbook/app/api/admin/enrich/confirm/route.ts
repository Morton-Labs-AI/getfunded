import { adminRoute, adminSql } from "@/lib/admin/db";
import type { ExtractedFacts } from "@/lib/admin/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The human gate. One transaction: supersede any prior confirmed row, insert
 * the new confirmed row (append-only history — uq_owf_confirmed enforces one
 * confirmed row per org), and record the ingestion_ledger run. The full
 * extraction (fields + confidence + verbatim snippets) is preserved in
 * raw_source as the audit trail.
 */
export async function POST(req: Request) {
  return adminRoute(req, async () => {
    const body = await req.json().catch(() => null);
    const orgId = String(body?.org_id ?? "");
    const rawFileId = Number(body?.raw_file_id ?? 0);
    const finalUrl = String(body?.final_url ?? "");
    const model = String(body?.model ?? "");
    const fields = body?.fields as ExtractedFacts | undefined;
    if (!UUID_RE.test(orgId) || !rawFileId || !finalUrl || !model || !fields) {
      return Response.json(
        { error: "org_id, raw_file_id, final_url, model, fields required" },
        { status: 400 }
      );
    }

    const reviewedBy = body?.reviewed_by ? String(body.reviewed_by) : "human:zach";
    const notes = body?.notes ? String(body.notes).slice(0, 2000) : null;
    const confidences = Object.values(fields.confidence ?? {}).filter(
      (v): v is number => typeof v === "number" && v > 0 && v <= 1
    );
    const overallConfidence =
      confidences.length > 0
        ? confidences.reduce((s, v) => s + v, 0) / confidences.length
        : null;

    const result = await adminSql.begin(async (sql) => {
      const superseded = await sql`
        update internal.org_web_facts set status = 'superseded'
        where org_id = ${orgId} and status = 'confirmed'
        returning id`;

      const [row] = await sql`
        insert into internal.org_web_facts
          (org_id, website_url, focus_areas, giving_priorities, application_info,
           application_url, accepts_unsolicited, geographic_focus, people,
           extracted_summary, extraction_model, extraction_confidence,
           extracted_at, status, reviewed_by, created_by, notes, raw_source,
           raw_file_id, source_record_locator)
        values
          (${orgId}, ${fields.website_url || finalUrl},
           ${sql.array(fields.focus_areas ?? [])},
           ${fields.giving_priorities ?? null}, ${fields.application_info ?? null},
           ${fields.application_url ?? null}, ${fields.accepts_unsolicited ?? null},
           ${sql.array(fields.geographic_focus ?? [])},
           ${sql.json(JSON.parse(JSON.stringify(fields.people ?? [])))},
           ${fields.extracted_summary ?? null}, ${model}, ${overallConfidence},
           now(), 'confirmed', ${reviewedBy}, 'ui:enrich', ${notes},
           ${sql.json(JSON.parse(JSON.stringify(fields)))},
           ${rawFileId}, ${"url:" + finalUrl})
        returning id`;

      const [run] = await sql`
        insert into internal.ingestion_ledger
          (raw_file_id, dataset_name, status, completed_at,
           rows_inserted, rows_updated, created_by, notes)
        values
          (${rawFileId}, 'funder_website', 'completed', now(),
           1, ${superseded.length}, 'ui:enrich',
           ${"org_web_facts confirm for org " + orgId})
        returning id`;

      return {
        factsId: Number(row.id),
        superseded: superseded.length,
        ledgerRunId: Number(run.id),
      };
    });

    return Response.json({ ok: true, ...result });
  });
}

import { sql } from "@/lib/db";
import { extractFilingXml } from "@/lib/filing-xml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stream the original IRS e-file XML for one filing, straight out of the
    locally staged batch zip. Read-only (read pool + FUNDERDB_RAW_DIR); the
    browser's native XML tree view IS the escape-hatch UI. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ objectId: string }> }
) {
  const { objectId } = await params;
  if (!/^\d{18}$/.test(objectId)) {
    return new Response("Not found", { status: 404 });
  }
  const rows = await sql<{ storage_path: string }[]>`
    select rf.storage_path
    from internal.filings f
    join internal.raw_files rf on rf.id = f.raw_file_id
    where f.object_id = ${objectId}`;
  if (rows.length === 0) {
    return new Response("No such filing on record.", { status: 404 });
  }
  const result = await extractFilingXml(rows[0].storage_path, objectId);
  if (!result.ok) {
    return new Response(result.message, {
      status: result.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(new Uint8Array(result.data), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `inline; filename="${result.fileName}"`,
      "cache-control": "no-store",
    },
  });
}

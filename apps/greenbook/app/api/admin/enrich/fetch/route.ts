import { adminRoute } from "@/lib/admin/db";
import {
  EnrichError,
  extractFacts,
  fetchBundle,
  readSnapshot,
  sameDaySnapshot,
  snapshotAndRegister,
} from "@/lib/admin/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Fetch + snapshot + extract. Registers the snapshot in raw_files (history is
 * append-only and harmless), returns the extraction as a PREVIEW — nothing is
 * written to org_web_facts until the human confirms.
 */
export async function POST(req: Request) {
  return adminRoute(req, async () => {
    const body = await req.json().catch(() => null);
    const orgId = String(body?.org_id ?? "");
    const url = String(body?.url ?? "");
    const orgName = String(body?.org_name ?? "");
    const force = Boolean(body?.force);
    if (!UUID_RE.test(orgId) || !url) {
      return Response.json({ error: "org_id (uuid) and url required" }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(url)) {
      return Response.json({ error: "url must be http(s)" }, { status: 400 });
    }

    try {
      let bundle;
      let record;
      let reused = false;
      const existing = force ? null : await sameDaySnapshot(orgId);
      if (existing) {
        bundle = readSnapshot(existing.storagePath);
        record = {
          rawFileId: existing.rawFileId,
          sha256: existing.sha256,
          filename: existing.storagePath.split("/").pop() ?? "",
          storagePath: existing.storagePath,
        };
        reused = true;
      } else {
        bundle = await fetchBundle(orgId, orgName, url);
        record = await snapshotAndRegister(bundle);
      }

      const { fields, model } = await extractFacts(bundle.org_name || orgName, bundle.pages);

      return Response.json({
        ok: true,
        reused,
        raw_file_id: record.rawFileId,
        sha256: record.sha256,
        snapshot_file: record.filename,
        final_url: bundle.pages[0].final_url,
        fetched_at: bundle.fetched_at,
        page_count: bundle.pages.length,
        pages: bundle.pages.map((p) => p.final_url),
        extraction: { fields, model },
      });
    } catch (e) {
      if (e instanceof EnrichError) {
        return Response.json({ stage: e.stage, error: e.message }, { status: 422 });
      }
      throw e;
    }
  });
}

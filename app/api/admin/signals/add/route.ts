import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { adminRoute, adminSql } from "@/lib/admin/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EIN_RE = /^\d{9}$/;

/** Drop the fragment and tracking parameters (same rule as the corpus pipeline). */
function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$)/i.test(key)) u.searchParams.delete(key);
  u.hostname = u.hostname.toLowerCase();
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/**
 * A person found an announcement (a LinkedIn post, a newsletter): record the
 * URL as a candidate signal, file-first. The submission itself is written as
 * a small JSON file, sha256-registered in internal.raw_files under OUR
 * dataset (funder_signals, cc_by), and the row points at it. `funderdb
 * signals process` then fetches, snapshots and classifies it. Same contract
 * as `funderdb signals add`.
 */
export async function POST(req: Request) {
  return adminRoute(req, async () => {
    const body = await req.json().catch(() => null);
    let url: string;
    try {
      url = canonicalUrl(String(body?.url ?? ""));
      if (!/^https?:$/.test(new URL(url).protocol)) throw new Error("scheme");
    } catch {
      return Response.json({ error: "a valid http(s) url is required" }, { status: 400 });
    }
    const ein = body?.ein ? String(body.ein).replace(/\D/g, "").padStart(9, "0") : null;
    if (ein && !EIN_RE.test(ein)) return Response.json({ error: "ein must be 9 digits" }, { status: 400 });
    const note = body?.discovery_note ? String(body.discovery_note).slice(0, 2000) : null;
    const submittedBy = body?.submitted_by ? String(body.submitted_by).slice(0, 80) : "ui:zach";

    const rawDir = process.env.FUNDERDB_RAW_DIR;
    if (!rawDir) return Response.json({ error: "FUNDERDB_RAW_DIR is not set" }, { status: 500 });
    const payload = {
      kind: "manual_submission", url, ein, submitted_by: submittedBy, note, submitted_at: new Date().toISOString(), count: 1,
    };
    const bytes = Buffer.from(JSON.stringify(payload, null, 2) + "\n", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const dir = join(rawDir, "funder_signals");
    await mkdir(dir, { recursive: true });
    const filename = `${sha256.slice(0, 12)}_signal-submission-${payload.submitted_at.replace(/[:.]/g, "").slice(0, 15)}Z.json`;
    const storagePath = join(dir, filename);
    await writeFile(storagePath, bytes, { flag: "wx" }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });

    const result = await adminSql.begin(async (sql) => {
      const [rf] = await sql`
        insert into internal.raw_files
          (dataset_name, source_url, storage_path, sha256, byte_size, content_type, license_code, as_of_date, meta)
        values ('funder_signals', ${url}, ${storagePath}, ${sha256}, ${bytes.byteLength},
                'application/json', 'cc_by', current_date,
                ${sql.json({ kind: "manual_submission", curated_by: "Morton Labs", items: 1 })})
        on conflict (sha256) do update set source_url = excluded.source_url
        returning id`;
      const rawFileId = Number(rf.id);
      const inserted = await sql`
        insert into internal.funder_signals (url, submitted_by, discovery_note, raw_file_id, source_record_locator)
        values (${url}, ${submittedBy}, ${note}, ${rawFileId}, ${"url:" + url})
        on conflict (url) do nothing
        returning id`;
      const [existing] = inserted.length ? inserted : await sql`select id from internal.funder_signals where url = ${url}`;
      const signalId = Number(existing.id);
      let orgId: string | null = null;
      let linked = false;
      if (ein) {
        const orgs = await sql`
          select o.id from internal.org_identifiers i
          join internal.organizations o on o.id = i.org_id
          where i.id_type = 'ein' and i.id_value = ${ein}
          order by (o.canonical_org_id is null) desc limit 1`;
        orgId = orgs[0] ? String(orgs[0].id) : null;
        if (orgId) {
          const link = await sql`
            insert into internal.funder_signal_orgs (signal_id, org_id, role, match_method, confidence)
            values (${signalId}, ${orgId}, 'subject', 'ein', 1.0)
            on conflict do nothing returning signal_id`;
          linked = link.length > 0;
        }
      }
      await sql`
        insert into internal.ingestion_ledger
          (raw_file_id, dataset_name, status, completed_at, rows_inserted, rows_skipped, created_by, notes)
        values (${rawFileId}, 'funder_signals', 'completed', now(), ${inserted.length}, ${inserted.length ? 0 : 1},
                'ui:signals', ${"manual submission " + url})`;
      return { signalId, created: inserted.length > 0, orgId, linked, rawFileId };
    });

    return Response.json({
      ok: true,
      ...result,
      next: "Run `uv run funderdb signals process` in the corpus repo to fetch, snapshot and classify it; then publish here.",
      warning: ein && !result.orgId ? `EIN ${ein} is not in internal.org_identifiers; the signal is unlinked` : null,
    });
  });
}

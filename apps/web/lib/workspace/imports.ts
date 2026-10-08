import "server-only";

import { z } from "zod";

import { DbError } from "@/lib/db/app";
import { corpusQuery } from "@/lib/db/corpus";

import {
  IMPORT_MAX_ROWS,
  decideMatch,
  isAdded,
  normalizeName,
  type ImportRow,
  type MatchCandidate,
  type MatchDecision,
  type MatchStatus,
} from "./import-match";
import { countSaved, workspacePlan } from "./saved";
import { snapshotToJson } from "./snapshot";
import { int, iso, obj, run, type Deps } from "./sql";
import type { FunderSnapshot, ImportSummary, WorkspaceCtx } from "./types";

/**
 * CSV import, two halves:
 *  1. MATCH (read-only corpus transaction): EIN exact first, then exact
 *     normalised name. Fuzzy neighbours are reported as candidates only.
 *  2. WRITE (workspace transaction): one `imports` row with the full report,
 *     plus a saved funder, its stage-history row and a system activity for
 *     every row that matched. Rows that are already on the list are reported
 *     and left untouched. Nothing merges silently.
 */

export const importRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  name: z.string().trim().max(500).nullable(),
  ein: z.string().regex(/^\d{9}$/).nullable(),
  notes: z.string().trim().max(2000).nullable(),
});

export const runImportSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  rows: z.array(importRowSchema).min(1, "The file has no data rows.").max(IMPORT_MAX_ROWS, `Import up to ${IMPORT_MAX_ROWS} rows at a time.`),
});
export type RunImportInput = z.infer<typeof runImportSchema>;

export type ImportReportRow = {
  rowNumber: number;
  name: string | null;
  ein: string | null;
  notes: string | null;
  status: MatchStatus;
  orgId: string | null;
  savedFunderId: string | null;
  reason: string;
  candidates: MatchCandidate[];
};

export type ImportReport = {
  version: 1;
  filename: string;
  counts: Record<MatchStatus, number>;
  rows: ImportReportRow[];
};

type CorpusHit = { org_id: string; name: string | null; city: string | null; state: string | null; website: string | null; org_type: string | null; ein: string | null };

function toCandidate(h: CorpusHit): MatchCandidate {
  return { orgId: h.org_id, name: h.name ?? "Unnamed organization", city: h.city, state: h.state, ein: h.ein };
}

function toSnapshot(h: CorpusHit): FunderSnapshot {
  return {
    orgId: h.org_id,
    name: h.name ?? "Unnamed organization",
    ein: h.ein,
    orgType: h.org_type,
    city: h.city,
    state: h.state,
    website: h.website,
  };
}

/** Corpus lookups for every row, batched where the query allows it. */
export async function matchRows(rows: ReadonlyArray<ImportRow>): Promise<{
  einHits: Map<string, CorpusHit[]>;
  nameHits: Map<number, CorpusHit[]>;
  byOrg: Map<string, CorpusHit>;
}> {
  const eins = Array.from(new Set(rows.map((r) => r.ein).filter((e): e is string => Boolean(e))));
  const einHits = new Map<string, CorpusHit[]>();
  const nameHits = new Map<number, CorpusHit[]>();
  const byOrg = new Map<string, CorpusHit>();

  await corpusQuery(async (sql) => {
    if (eins.length > 0) {
      const hits = await sql<(CorpusHit & { id_value: string })[]>`
        select i.id_value, o.id as org_id, o.name, o.city, o.state, o.website, o.org_type, i.id_value as ein
        from public.org_identifiers i
        join public.organizations o on o.id = i.org_id
        where i.id_type = 'ein' and i.id_value = any(${eins}::text[])
        limit ${eins.length * 4}`;
      for (const h of hits) {
        const list = einHits.get(h.id_value) ?? [];
        list.push(h);
        einHits.set(h.id_value, list);
        byOrg.set(h.org_id, h);
      }
    }

    for (const row of rows) {
      if (!row.name) continue;
      if (row.ein && (einHits.get(row.ein)?.length ?? 0) === 1) continue;
      const key = normalizeName(row.name);
      if (!key) continue;
      const hits = await sql<CorpusHit[]>`
        select o.id as org_id, o.name, o.city, o.state, o.website, o.org_type,
               (select i.id_value from public.org_identifiers i
                 where i.org_id = o.id and i.id_type = 'ein' order by i.confidence desc nulls last limit 1) as ein
        from public.organizations o
        where o.name % ${row.name}
        order by similarity(o.name, ${row.name}) desc
        limit 10`;
      nameHits.set(row.rowNumber, hits);
      for (const h of hits) byOrg.set(h.org_id, h);
    }
  });

  return { einHits, nameHits, byOrg };
}

export type RunImportResult =
  | { ok: true; importId: string; added: number; total: number }
  | { ok: false; code: "invalid" | "forbidden"; message: string };

export async function runImport(ctx: WorkspaceCtx, input: RunImportInput, deps?: Deps): Promise<RunImportResult> {
  const parsed = runImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Check the file and try again." };
  const { filename, rows } = parsed.data;

  const { einHits, nameHits, byOrg } = await matchRows(rows);

  try {
    return await run(ctx, deps, async (sql) => {
      const existing = await sql<{ org_id: string; id: string }[]>`
        select org_id, id from getfunded.saved_funders where workspace_id = ${ctx.workspaceId}::uuid and archived_at is null`;
      const savedByOrg = new Map(existing.map((r) => [r.org_id, r.id]));
      const savedOrgIds = new Set(savedByOrg.keys());

      const plan = await workspacePlan(sql, ctx.workspaceId);
      const limit = plan.saved_funders_limit;
      let count = await countSaved(sql, ctx.workspaceId);

      const report: ImportReport = {
        version: 1,
        filename,
        counts: { matched_ein: 0, matched_name: 0, already_saved: 0, ambiguous: 0, unmatched: 0, empty: 0, limit_reached: 0 },
        rows: [],
      };

      // Insert the report row first so every saved funder can point at it.
      const imp = await sql<{ id: string }[]>`
        insert into getfunded.imports (workspace_id, filename, row_count, matched, unmatched, report, created_by)
        values (${ctx.workspaceId}::uuid, ${filename}, ${rows.length}, 0, 0, '{}'::jsonb, ${ctx.userId}::uuid)
        returning id`;
      const importId = imp[0].id;

      for (const row of rows) {
        const decision: MatchDecision = decideMatch({
          row,
          einHits: (row.ein ? (einHits.get(row.ein) ?? []) : []).map(toCandidate),
          nameHits: (nameHits.get(row.rowNumber) ?? []).map(toCandidate),
          savedOrgIds,
        });

        let status = decision.status;
        let savedFunderId: string | null = decision.orgId ? (savedByOrg.get(decision.orgId) ?? null) : null;
        let reason = decision.reason;

        if (isAdded(status) && decision.orgId) {
          if (limit !== null && count >= limit) {
            status = "limit_reached";
            reason = `Matched, but your plan holds ${limit} saved funders. Upgrade to add the rest.`;
          } else {
            const hit = byOrg.get(decision.orgId);
            const snapshot = hit ? toSnapshot(hit) : null;
            if (snapshot) {
              const sourceDetail = `Imported from ${filename} (row ${row.rowNumber})`;
              const inserted = await sql<{ id: string }[]>`
                insert into getfunded.saved_funders (workspace_id, org_id, snapshot, stage, source_detail, created_by, tags)
                values (${ctx.workspaceId}::uuid, ${decision.orgId}::uuid, ${sql.json(snapshotToJson(snapshot))},
                        'identified', ${sourceDetail}, ${ctx.userId}::uuid, ${["imported"]}::text[])
                on conflict (workspace_id, org_id) do nothing
                returning id`;
              if (inserted[0]) {
                savedFunderId = inserted[0].id;
                savedByOrg.set(decision.orgId, savedFunderId);
                savedOrgIds.add(decision.orgId);
                count += 1;
                await sql`
                  insert into getfunded.stage_history (saved_funder_id, workspace_id, from_stage, to_stage, changed_by, note)
                  values (${savedFunderId}::uuid, ${ctx.workspaceId}::uuid, null, 'identified', ${ctx.userId}::uuid, ${sourceDetail})`;
                await sql`
                  insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
                  values (${ctx.workspaceId}::uuid, ${savedFunderId}::uuid, 'system', ${sourceDetail}, ${ctx.userId}::uuid,
                          ${sql.json({ event: "import", import_id: importId, row: row.rowNumber, matched_by: status === "matched_ein" ? "ein" : "name" })})`;
                if (row.notes) {
                  await sql`
                    insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
                    values (${ctx.workspaceId}::uuid, ${savedFunderId}::uuid, 'note', ${row.notes}, ${ctx.userId}::uuid,
                            ${sql.json({ event: "import_note", import_id: importId, row: row.rowNumber })})`;
                }
              } else {
                // A concurrent save beat us to it: report, do not merge.
                status = "already_saved";
                reason = "Already on your list. Nothing was changed.";
              }
            } else {
              status = "unmatched";
              reason = "The matched record could not be read. Try again.";
            }
          }
        }

        report.counts[status] += 1;
        report.rows.push({
          rowNumber: row.rowNumber,
          name: row.name,
          ein: row.ein,
          notes: row.notes,
          status,
          orgId: decision.orgId,
          savedFunderId,
          reason,
          candidates: decision.candidates,
        });
      }

      const matched = report.counts.matched_ein + report.counts.matched_name;
      const unmatched = rows.length - matched - report.counts.already_saved;
      await sql`
        update getfunded.imports
        set matched = ${matched}, unmatched = ${unmatched}, report = ${sql.json(report)}
        where id = ${importId}::uuid`;

      return { ok: true, importId, added: matched, total: rows.length };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to import here." };
    throw error;
  }
}

type ImportRowDb = {
  id: string;
  filename: string;
  row_count: number | string;
  matched: number | string;
  unmatched: number | string;
  created_at: unknown;
  created_by_name: string | null;
  report?: unknown;
};

function toSummary(r: ImportRowDb): ImportSummary {
  return {
    id: r.id,
    filename: r.filename,
    rowCount: int(r.row_count),
    matched: int(r.matched),
    unmatched: int(r.unmatched),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    createdByName: r.created_by_name?.trim() || null,
  };
}

export async function listImports(ctx: WorkspaceCtx, deps?: Deps): Promise<ImportSummary[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<ImportRowDb[]>`
      select i.id, i.filename, i.row_count, i.matched, i.unmatched, i.created_at,
             coalesce(nullif(u.display_name, ''), u.email) as created_by_name
      from getfunded.imports i
      left join getfunded.users u on u.id = i.created_by
      where i.workspace_id = ${ctx.workspaceId}::uuid
      order by i.created_at desc
      limit 50`;
    return rows.map(toSummary);
  });
}

export async function getImport(
  ctx: WorkspaceCtx,
  id: string,
  deps?: Deps,
): Promise<{ summary: ImportSummary; report: ImportReport | null } | null> {
  if (!z.uuid().safeParse(id).success) return null;
  return run(ctx, deps, async (sql) => {
    const rows = await sql<ImportRowDb[]>`
      select i.id, i.filename, i.row_count, i.matched, i.unmatched, i.created_at, i.report,
             coalesce(nullif(u.display_name, ''), u.email) as created_by_name
      from getfunded.imports i
      left join getfunded.users u on u.id = i.created_by
      where i.workspace_id = ${ctx.workspaceId}::uuid and i.id = ${id}::uuid`;
    const row = rows[0];
    if (!row) return null;
    const raw = obj(row.report);
    const report = raw.version === 1 && Array.isArray(raw.rows) ? (raw as unknown as ImportReport) : null;
    return { summary: toSummary(row), report };
  });
}

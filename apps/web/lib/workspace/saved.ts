import "server-only";

import { z } from "zod";

import { DbError } from "@/lib/db/app";
import { planFor, type ResolvedPlan } from "@/lib/plans";

import { snapshotFromJson, snapshotToJson } from "./snapshot";
import { int, intOrNull, iso, likePattern, run, text, ymd, type Deps, type Sql } from "./sql";
import { isStage, type Stage } from "./stages";
import type { Collection, FunderSnapshot, SavedFilters, SavedFunder, Tier, WorkspaceCtx } from "./types";

/**
 * Saved funders: THE save transaction, the working list, compare-and-swap
 * edits, stage moves through `getfunded.move_stage()`, and named lists
 * (collections).
 *
 * Doctrine carried over from the design docs:
 *  - a save snapshots the corpus identity on the row (soft reference);
 *  - a save opens the stage history and logs a system activity, in the same
 *    transaction, so the funnel never has a hole;
 *  - every edit is a compare-and-swap on `version`; a stale edit is refused,
 *    never silently overwritten;
 *  - plan limits (`saved_funders_limit`, `pipelines_limit`) are checked here,
 *    in SQL order, not in the browser.
 */

/* ----------------------------------------------------------------- schemas */

export const snapshotSchema = z.object({
  orgId: z.uuid(),
  name: z.string().trim().min(1).max(300),
  ein: z.string().regex(/^\d{9}$/).nullable(),
  orgType: z.string().max(80).nullable(),
  city: z.string().max(120).nullable(),
  state: z.string().max(2).nullable(),
  website: z.string().max(500).nullable(),
}) satisfies z.ZodType<FunderSnapshot>;

export const stageSchema = z.enum([
  "identified",
  "researching",
  "qualified",
  "cultivating",
  "loi_submitted",
  "proposal_submitted",
  "awarded",
  "declined",
  "parked",
]);

export const tierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const savedPatchSchema = z
  .object({
    tier: tierSchema.nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    askAmount: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
    nextAction: z.string().trim().max(500).nullable().optional(),
    nextActionDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    sourceDetail: z.string().trim().max(2000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .strict();

export type SavedPatch = z.infer<typeof savedPatchSchema>;

/* ------------------------------------------------------------------- rows */

type SavedRow = {
  id: string;
  workspace_id: string;
  org_id: string;
  snapshot: unknown;
  stage: string;
  tier: number | null;
  owner_id: string | null;
  owner_name: string | null;
  ask_amount: string | number | null;
  next_action: string | null;
  next_action_due: unknown;
  source_detail: string | null;
  tags: string[] | null;
  archived_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  version: number | string;
  last_touch_at: unknown;
  open_tasks: number | string | null;
  stage_entered_at: unknown;
};

function toSaved(r: SavedRow): SavedFunder {
  const stage: Stage = isStage(r.stage) ? r.stage : "identified";
  const tier = r.tier === 1 || r.tier === 2 || r.tier === 3 ? (r.tier as Tier) : null;
  const createdAt = iso(r.created_at) ?? new Date(0).toISOString();
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    orgId: r.org_id,
    snapshot: snapshotFromJson(r.org_id, r.snapshot),
    stage,
    tier,
    ownerId: r.owner_id,
    ownerName: r.owner_name?.trim() || null,
    askAmount: intOrNull(r.ask_amount),
    nextAction: text(r.next_action),
    nextActionDue: ymd(r.next_action_due),
    sourceDetail: text(r.source_detail),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
    archivedAt: iso(r.archived_at),
    createdAt,
    updatedAt: iso(r.updated_at) ?? createdAt,
    version: int(r.version, 1),
    lastTouchAt: iso(r.last_touch_at),
    openTasks: int(r.open_tasks, 0),
    stageEnteredAt: iso(r.stage_entered_at) ?? createdAt,
  };
}

/** The SELECT list every saved-funder read shares. `f` is getfunded.saved_funders. */
function selectSaved(sql: Sql) {
  return sql`
    select f.id, f.workspace_id, f.org_id, f.snapshot, f.stage, f.tier, f.owner_id,
           coalesce(nullif(u.display_name, ''), u.email) as owner_name,
           f.ask_amount, f.next_action, f.next_action_due, f.source_detail, f.tags,
           f.archived_at, f.created_at, f.updated_at, f.version,
           (select max(a.occurred_at) from getfunded.activities a
             where a.saved_funder_id = f.id and a.kind <> 'system') as last_touch_at,
           (select count(*)::int from getfunded.tasks t
             where t.saved_funder_id = f.id and t.status = 'open') as open_tasks,
           (select max(h.created_at) from getfunded.stage_history h
             where h.saved_funder_id = f.id) as stage_entered_at
    from getfunded.saved_funders f
    left join getfunded.users u on u.id = f.owner_id`;
}

/* ------------------------------------------------------------------- plan */

type WorkspacePlanRow = { plan: string | null; monthly_credits: number | null; members: number | null };

export async function workspacePlan(sql: Sql, workspaceId: string): Promise<ResolvedPlan> {
  const rows = await sql<WorkspacePlanRow[]>`
    select w.plan, o.monthly_credits, o.members
    from getfunded.workspaces w
    left join getfunded.plan_overrides o on o.workspace_id = w.id
    where w.id = ${workspaceId}::uuid and w.deleted_at is null`;
  const row = rows[0];
  return planFor(row ? { plan: row.plan } : null, row ? { monthly_credits: row.monthly_credits, members: row.members } : null);
}

export async function countSaved(sql: Sql, workspaceId: string): Promise<number> {
  const rows = await sql<{ n: number | string }[]>`
    select count(*)::int as n from getfunded.saved_funders
    where workspace_id = ${workspaceId}::uuid and archived_at is null`;
  return int(rows[0]?.n, 0);
}

/* ------------------------------------------------------------------- save */

export type SaveResult =
  | { ok: true; savedFunderId: string; inserted: boolean }
  | { ok: false; code: "limit_reached"; message: string; limit: number; upgradeUrl: string }
  | { ok: false; code: "forbidden" | "invalid" | "unknown"; message: string };

/**
 * Save a funder to the workspace. Idempotent: saving an org that is already
 * on the list (or archived) returns the existing row un-archived and changes
 * nothing else. A new row opens its stage history at `identified` and logs a
 * system activity in the same transaction.
 */
export async function saveFunder(
  ctx: WorkspaceCtx,
  input: { snapshot: FunderSnapshot; sourceDetail?: string | null },
  deps?: Deps,
): Promise<SaveResult> {
  const parsed = snapshotSchema.safeParse(input.snapshot);
  if (!parsed.success) return { ok: false, code: "invalid", message: "That funder record is incomplete." };
  const snapshot = parsed.data;
  const sourceDetail = input.sourceDetail?.trim().slice(0, 2000) || null;

  try {
    return await run(ctx, deps, async (sql) => {
      const existing = await sql<{ id: string; archived_at: unknown }[]>`
        select id, archived_at from getfunded.saved_funders
        where workspace_id = ${ctx.workspaceId}::uuid and org_id = ${snapshot.orgId}::uuid
        for update`;
      if (existing[0]) {
        if (existing[0].archived_at) {
          await sql`
            update getfunded.saved_funders
            set archived_at = null, snapshot = ${sql.json(snapshotToJson(snapshot))}
            where id = ${existing[0].id}::uuid`;
          await sql`
            insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
            values (${ctx.workspaceId}::uuid, ${existing[0].id}::uuid, 'system', 'Restored to the list', ${ctx.userId}::uuid,
                    ${sql.json({ event: "restored" })})`;
        }
        return { ok: true, savedFunderId: existing[0].id, inserted: false };
      }

      const plan = await workspacePlan(sql, ctx.workspaceId);
      const limit = plan.saved_funders_limit;
      if (limit !== null) {
        const n = await countSaved(sql, ctx.workspaceId);
        if (n >= limit) {
          return {
            ok: false,
            code: "limit_reached",
            message: `Your plan holds ${limit} saved funders. Upgrade to save more, or archive funders you are no longer working.`,
            limit,
            upgradeUrl: "/app/settings/billing",
          };
        }
      }

      const inserted = await sql<{ id: string }[]>`
        insert into getfunded.saved_funders (workspace_id, org_id, snapshot, stage, source_detail, created_by)
        values (${ctx.workspaceId}::uuid, ${snapshot.orgId}::uuid, ${sql.json(snapshotToJson(snapshot))},
                'identified', ${sourceDetail}, ${ctx.userId}::uuid)
        returning id`;
      const id = inserted[0].id;
      await sql`
        insert into getfunded.stage_history (saved_funder_id, workspace_id, from_stage, to_stage, changed_by)
        values (${id}::uuid, ${ctx.workspaceId}::uuid, null, 'identified', ${ctx.userId}::uuid)`;
      await sql`
        insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
        values (${ctx.workspaceId}::uuid, ${id}::uuid, 'system', ${`Saved to the list${sourceDetail ? `: ${sourceDetail}` : ""}`},
                ${ctx.userId}::uuid, ${sql.json({ event: "saved", source_detail: sourceDetail })})`;
      return { ok: true, savedFunderId: id, inserted: true };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You are not a member of this workspace." };
    if (DbError.is(error, "conflict")) {
      // Lost a race with a parallel save of the same org: it is on the list now.
      const row = await getSavedByOrg(ctx, snapshot.orgId, deps);
      if (row) return { ok: true, savedFunderId: row.id, inserted: false };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ reads */

export async function listSaved(ctx: WorkspaceCtx, filters: SavedFilters = {}, deps?: Deps): Promise<SavedFunder[]> {
  const q = filters.q?.trim().slice(0, 200);
  const digits = q ? q.replace(/\D/g, "") : "";
  const einLike = digits.length >= 4 ? `%${digits}%` : null;
  return run(ctx, deps, async (sql) => {
    const rows = await sql<SavedRow[]>`
      ${selectSaved(sql)}
      where f.workspace_id = ${ctx.workspaceId}::uuid
        and f.archived_at is null
        ${
          q
            ? sql`and (
                f.snapshot->>'name' ilike ${likePattern(q)}
                or coalesce(f.source_detail, '') ilike ${likePattern(q)}
                or coalesce(f.next_action, '') ilike ${likePattern(q)}
                or exists (select 1 from unnest(f.tags) t where t ilike ${likePattern(q)})
                ${einLike ? sql`or coalesce(f.snapshot->>'ein', '') like ${einLike}` : sql``}
              )`
            : sql``
        }
        ${filters.stage ? sql`and f.stage = ${filters.stage}` : sql``}
        ${filters.ownerId ? sql`and f.owner_id = ${filters.ownerId}::uuid` : sql``}
        ${filters.tier ? sql`and f.tier = ${filters.tier}` : sql``}
        ${
          filters.collectionId
            ? sql`and exists (select 1 from getfunded.collection_items ci
                              where ci.collection_id = ${filters.collectionId}::uuid and ci.saved_funder_id = f.id)`
            : sql``
        }
      order by ${
        filters.sort === "name"
          ? sql`lower(f.snapshot->>'name') asc`
          : filters.sort === "due"
            ? sql`f.next_action_due asc nulls last, f.updated_at desc`
            : filters.sort === "ask"
              ? sql`f.ask_amount desc nulls last, f.updated_at desc`
              : sql`f.updated_at desc`
      }
      limit 2000`;
    return rows.map(toSaved);
  });
}

export async function getSavedByOrg(ctx: WorkspaceCtx, orgId: string, deps?: Deps): Promise<SavedFunder | null> {
  if (!z.uuid().safeParse(orgId).success) return null;
  return run(ctx, deps, async (sql) => {
    const rows = await sql<SavedRow[]>`
      ${selectSaved(sql)}
      where f.workspace_id = ${ctx.workspaceId}::uuid and f.org_id = ${orgId}::uuid and f.archived_at is null
      limit 1`;
    return rows[0] ? toSaved(rows[0]) : null;
  });
}

export async function getSavedById(ctx: WorkspaceCtx, id: string, deps?: Deps): Promise<SavedFunder | null> {
  if (!z.uuid().safeParse(id).success) return null;
  return run(ctx, deps, async (sql) => {
    const rows = await sql<SavedRow[]>`
      ${selectSaved(sql)}
      where f.workspace_id = ${ctx.workspaceId}::uuid and f.id = ${id}::uuid
      limit 1`;
    return rows[0] ? toSaved(rows[0]) : null;
  });
}

/** Which of these orgs are already saved here (for search results and import). */
export async function savedOrgIds(ctx: WorkspaceCtx, orgIds: ReadonlyArray<string>, deps?: Deps): Promise<Map<string, string>> {
  const ids = orgIds.filter((id) => z.uuid().safeParse(id).success);
  if (ids.length === 0) return new Map();
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ id: string; org_id: string }[]>`
      select id, org_id from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId}::uuid and archived_at is null and org_id = any(${ids}::uuid[])`;
    return new Map(rows.map((r) => [r.org_id, r.id]));
  });
}

/** Every live saved org id → saved_funders.id, so search results can show "Saved". */
export async function savedOrgIndex(ctx: WorkspaceCtx, deps?: Deps): Promise<Record<string, string>> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ id: string; org_id: string }[]>`
      select id, org_id from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId}::uuid and archived_at is null
      limit 5000`;
    const out: Record<string, string> = {};
    for (const r of rows) out[r.org_id] = r.id;
    return out;
  });
}

/* ------------------------------------------------------------------ edits */

export type EditResult =
  | { ok: true; version: number }
  | { ok: false; code: "stale" | "not_found" | "forbidden" | "invalid"; message: string };

const STALE_MESSAGE = "This funder was changed somewhere else. The page will reload with the latest version.";

/**
 * Compare-and-swap edit of the YOURS columns. The trigger bumps `version`;
 * zero rows updated means the version was stale (or the row is not visible).
 */
export async function updateSavedFunder(
  ctx: WorkspaceCtx,
  input: { id: string; version: number; patch: SavedPatch },
  deps?: Deps,
): Promise<EditResult> {
  const patch = savedPatchSchema.safeParse(input.patch);
  if (!patch.success) return { ok: false, code: "invalid", message: "Check the value and try again." };
  const p = patch.data;
  const keys = Object.keys(p);
  if (keys.length === 0) return { ok: false, code: "invalid", message: "Nothing to change." };

  const set: Record<string, unknown> = {};
  if ("tier" in p) set.tier = p.tier ?? null;
  if ("ownerId" in p) set.owner_id = p.ownerId ?? null;
  if ("askAmount" in p) set.ask_amount = p.askAmount ?? null;
  if ("nextAction" in p) set.next_action = p.nextAction || null;
  if ("nextActionDue" in p) set.next_action_due = p.nextActionDue ?? null;
  if ("sourceDetail" in p) set.source_detail = p.sourceDetail || null;
  if ("tags" in p) set.tags = p.tags ?? [];

  try {
    return await run(ctx, deps, async (sql) => {
      const rows = await sql<{ version: number | string }[]>`
        update getfunded.saved_funders
        set ${sql(set)}
        where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid
          and version = ${input.version} and archived_at is null
        returning version`;
      if (!rows[0]) {
        const exists = await sql<{ v: number }[]>`
          select version as v from getfunded.saved_funders
          where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
        return exists[0]
          ? { ok: false, code: "stale", message: STALE_MESSAGE }
          : { ok: false, code: "not_found", message: "That funder is no longer on the list." };
      }
      return { ok: true, version: int(rows[0].version, input.version + 1) };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to edit this list." };
    throw error;
  }
}

/**
 * Stage move through the `getfunded.move_stage()` door: compare-and-swap,
 * stage_history row, system activity, all in Postgres. `expectedVersion`
 * null skips the CAS (bulk moves from the list use that).
 */
export async function moveStage(
  ctx: WorkspaceCtx,
  input: { id: string; stage: Stage; expectedVersion: number | null; note?: string | null },
  deps?: Deps,
): Promise<EditResult> {
  if (!z.uuid().safeParse(input.id).success || !isStage(input.stage)) {
    return { ok: false, code: "invalid", message: "That stage is not one of the pipeline stages." };
  }
  try {
    return await run(ctx, deps, async (sql) => {
      const owned = await sql<{ id: string }[]>`
        select id from getfunded.saved_funders
        where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid and archived_at is null`;
      if (!owned[0]) return { ok: false, code: "not_found", message: "That funder is no longer on the list." };
      const rows = await sql<{ v: number | string }[]>`
        select getfunded.move_stage(${input.id}::uuid, ${input.stage}, ${input.expectedVersion}, ${input.note?.trim() || null}) as v`;
      return { ok: true, version: int(rows[0]?.v, 0) };
    });
  } catch (error) {
    if (error instanceof DbError) {
      if (error.pgCode === "40001") return { ok: false, code: "stale", message: STALE_MESSAGE };
      if (error.code === "forbidden") return { ok: false, code: "forbidden", message: "You do not have permission to move funders here." };
      if (/saved_funder_not_found/.test(error.message)) return { ok: false, code: "not_found", message: "That funder is no longer on the list." };
    }
    throw error;
  }
}

export async function bulkMoveStage(
  ctx: WorkspaceCtx,
  input: { ids: string[]; stage: Stage },
  deps?: Deps,
): Promise<{ moved: number; failed: number }> {
  let moved = 0;
  let failed = 0;
  for (const id of input.ids) {
    const r = await moveStage(ctx, { id, stage: input.stage, expectedVersion: null }, deps);
    if (r.ok) moved += 1;
    else failed += 1;
  }
  return { moved, failed };
}

export async function archiveSavedFunder(ctx: WorkspaceCtx, input: { id: string; version: number }, deps?: Deps): Promise<EditResult> {
  try {
    return await run(ctx, deps, async (sql) => {
      const rows = await sql<{ version: number | string }[]>`
        update getfunded.saved_funders
        set archived_at = now()
        where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid
          and version = ${input.version} and archived_at is null
        returning version`;
      if (!rows[0]) return { ok: false, code: "stale", message: STALE_MESSAGE };
      await sql`
        insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
        values (${ctx.workspaceId}::uuid, ${input.id}::uuid, 'system', 'Archived from the list', ${ctx.userId}::uuid,
                ${sql.json({ event: "archived" })})`;
      return { ok: true, version: int(rows[0].version, input.version + 1) };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to edit this list." };
    throw error;
  }
}

/* ------------------------------------------------------------ collections */

type CollectionRow = {
  id: string;
  name: string;
  description: string | null;
  is_shared: boolean;
  item_count: number | string;
  created_by: string | null;
  version: number | string;
};

export async function listCollections(ctx: WorkspaceCtx, deps?: Deps): Promise<Collection[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<CollectionRow[]>`
      select c.id, c.name, c.description, c.is_shared, c.created_by, c.version,
             (select count(*)::int from getfunded.collection_items ci
               join getfunded.saved_funders f on f.id = ci.saved_funder_id and f.archived_at is null
               where ci.collection_id = c.id) as item_count
      from getfunded.collections c
      where c.workspace_id = ${ctx.workspaceId}::uuid
      order by lower(c.name)`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isShared: Boolean(r.is_shared),
      itemCount: int(r.item_count, 0),
      createdBy: r.created_by,
      version: int(r.version, 1),
    }));
  });
}

export type CreateCollectionResult =
  | { ok: true; id: string }
  | { ok: false; code: "limit_reached"; message: string; limit: number; upgradeUrl: string }
  | { ok: false; code: "invalid" | "forbidden"; message: string };

/** Named lists are the "pipelines" the plan table counts (`pipelines_limit`). */
export async function createCollection(
  ctx: WorkspaceCtx,
  input: { name: string; description?: string | null },
  deps?: Deps,
): Promise<CreateCollectionResult> {
  const name = input.name.trim().slice(0, 120);
  if (name.length < 1) return { ok: false, code: "invalid", message: "Give the list a name." };
  try {
    return await run(ctx, deps, async (sql) => {
      const plan = await workspacePlan(sql, ctx.workspaceId);
      const limit = plan.pipelines_limit;
      if (limit !== null) {
        const n = await sql<{ n: number | string }[]>`
          select count(*)::int as n from getfunded.collections where workspace_id = ${ctx.workspaceId}::uuid`;
        if (int(n[0]?.n, 0) >= limit) {
          return {
            ok: false,
            code: "limit_reached",
            message: `Your plan allows ${limit} ${limit === 1 ? "list" : "lists"}. Upgrade to make more.`,
            limit,
            upgradeUrl: "/app/settings/billing",
          };
        }
      }
      const rows = await sql<{ id: string }[]>`
        insert into getfunded.collections (workspace_id, name, description, is_shared, created_by)
        values (${ctx.workspaceId}::uuid, ${name}, ${input.description?.trim() || null}, true, ${ctx.userId}::uuid)
        returning id`;
      return { ok: true, id: rows[0].id };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to make lists here." };
    throw error;
  }
}

export async function addToCollection(
  ctx: WorkspaceCtx,
  input: { collectionId: string; savedFunderIds: string[] },
  deps?: Deps,
): Promise<{ added: number }> {
  const ids = input.savedFunderIds.filter((id) => z.uuid().safeParse(id).success);
  if (ids.length === 0) return { added: 0 };
  return run(ctx, deps, async (sql) => {
    const owned = await sql<{ id: string }[]>`
      select id from getfunded.collections where id = ${input.collectionId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
    if (!owned[0]) return { added: 0 };
    const rows = await sql<{ saved_funder_id: string }[]>`
      insert into getfunded.collection_items (collection_id, saved_funder_id, position)
      select ${input.collectionId}::uuid, f.id,
             coalesce((select max(position) from getfunded.collection_items where collection_id = ${input.collectionId}::uuid), 0) + row_number() over ()
      from getfunded.saved_funders f
      where f.workspace_id = ${ctx.workspaceId}::uuid and f.id = any(${ids}::uuid[])
      on conflict do nothing
      returning saved_funder_id`;
    return { added: rows.length };
  });
}

/** Keep the plan object handy for pages that gate UI (export rows, reports). */
export async function getWorkspacePlan(ctx: WorkspaceCtx, deps?: Deps): Promise<ResolvedPlan> {
  return run(ctx, deps, (sql) => workspacePlan(sql, ctx.workspaceId));
}

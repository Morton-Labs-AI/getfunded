/**
 * URL state for the workspace list pages (/app/saved, /app/pipeline,
 * /app/tasks). The URL is the whole filter state, so a filtered view is a
 * link a person can send. Everything that arrives from the query string goes
 * through zod here; an unknown value is dropped, never guessed.
 *
 * Pure: no server imports, so client components and tests share it.
 */
import { z } from "zod";

import { STAGES } from "./stages";
import type { SavedFilters, TaskView } from "./types";

export type RawParams = Record<string, string | string[] | undefined>;

/** The first value of a (possibly repeated) query param, trimmed; empty is undefined. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const s = Array.isArray(value) ? value[0] : value;
  if (s === undefined || s === null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t;
}

const SORTS = ["name", "updated", "due", "ask"] as const;

const savedSchema = z.object({
  q: z.string().trim().min(1).max(200).optional().catch(undefined),
  stage: z.enum(STAGES).optional().catch(undefined),
  owner: z.uuid().optional().catch(undefined),
  tier: z.coerce.number().int().min(1).max(3).optional().catch(undefined),
  list: z.uuid().optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
});

/**
 * `?q=…&stage=…&owner=…&tier=…&list=…&sort=…` → SavedFilters. Keys are the
 * short names `savedFiltersToQuery` writes, so the two stay in step.
 */
export function parseSavedFilters(raw: RawParams | null | undefined): SavedFilters {
  const record: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw ?? {})) record[key] = firstParam(value);
  const r = savedSchema.parse(record);
  const out: SavedFilters = {};
  if (r.q) out.q = r.q;
  if (r.stage) out.stage = r.stage;
  if (r.owner) out.ownerId = r.owner;
  if (r.tier === 1 || r.tier === 2 || r.tier === 3) out.tier = r.tier;
  if (r.list) out.collectionId = r.list;
  if (r.sort) out.sort = r.sort;
  return out;
}

/** SavedFilters → `?q=…` (empty string when nothing is set). The default sort is omitted. */
export function savedFiltersToQuery(f: SavedFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.stage) p.set("stage", f.stage);
  if (f.ownerId) p.set("owner", f.ownerId);
  if (f.tier) p.set("tier", String(f.tier));
  if (f.collectionId) p.set("list", f.collectionId);
  if (f.sort && f.sort !== "updated") p.set("sort", f.sort);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** True when any narrowing filter is set (sort alone does not count). */
export function hasFilters(f: SavedFilters): boolean {
  return Boolean(f.q || f.stage || f.ownerId || f.tier || f.collectionId);
}

export const TASK_VIEWS: ReadonlyArray<{ key: TaskView; label: string }> = [
  { key: "open", label: "All open" },
  { key: "mine", label: "Mine" },
  { key: "today", label: "Due today" },
  { key: "overdue", label: "Overdue" },
  { key: "done", label: "Done" },
];

export function parseTaskView(value: string | string[] | undefined): TaskView {
  const v = firstParam(value);
  return TASK_VIEWS.some((t) => t.key === v) ? (v as TaskView) : "open";
}

/** `/app/tasks` for the default view, `/app/tasks?view=…` otherwise. */
export function taskViewHref(view: TaskView): string {
  return view === "open" ? "/app/tasks" : `/app/tasks?view=${view}`;
}

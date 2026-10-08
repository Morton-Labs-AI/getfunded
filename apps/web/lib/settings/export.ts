/**
 * The workspace export: a ZIP of JSON files a nonprofit can keep, move to
 * another install, or read without GetFunded.
 *
 * Pure shaping lives here (`buildWorkspaceExport`, `exportEntries`); the
 * database read is in ./service.ts (`loadWorkspaceExport`). Only the
 * workspace's OWN data is exported (the "Yours" class): saved funders with
 * their stage and notes, tasks, activities and stage history. Corpus facts are
 * public and re-fetchable, so a saved funder carries its snapshot (name, EIN,
 * type, city, state) and the corpus `org_id`, not the full filing record.
 * AI output is exported with its label so it can never be mistaken for a fact.
 */
import { createZip, type ZipEntry } from "./zip";

export const EXPORT_SCHEMA_VERSION = 1;

/** Keep the archive comfortably inside a single serverless response. */
export const EXPORT_ROW_CAP = 20_000;

export type ExportWorkspace = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  profile: unknown;
  settings: unknown;
  created_at: string | Date;
};

export type ExportMember = {
  user_id: string;
  role: string;
  email: string | null;
  display_name: string | null;
  joined_at: string | Date;
};

export type ExportSavedFunder = {
  id: string;
  org_id: string;
  snapshot: unknown;
  stage: string;
  tier: number | null;
  owner_id: string | null;
  ask_amount: number | string | null;
  next_action: string | null;
  next_action_due: string | Date | null;
  source_detail: string | null;
  tags: string[] | null;
  archived_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type ExportTask = {
  id: string;
  saved_funder_id: string | null;
  title: string;
  details: string | null;
  due_date: string | Date | null;
  assignee_id: string | null;
  status: string;
  completed_at: string | Date | null;
  created_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type ExportActivity = {
  id: string;
  saved_funder_id: string | null;
  kind: string;
  body: string;
  occurred_at: string | Date;
  created_by: string | null;
  meta: unknown;
  created_at: string | Date;
};

export type ExportStageHistory = {
  id: number | string;
  saved_funder_id: string;
  from_stage: string | null;
  to_stage: string;
  changed_by: string | null;
  note: string | null;
  created_at: string | Date;
};

export type WorkspaceExportInput = {
  workspace: ExportWorkspace;
  members: ExportMember[];
  saved_funders: ExportSavedFunder[];
  tasks: ExportTask[];
  activities: ExportActivity[];
  stage_history: ExportStageHistory[];
  exported_by: { user_id: string; email: string };
  exported_at?: Date;
  truncated?: string[];
};

export type WorkspaceExport = {
  schema_version: number;
  generator: string;
  exported_at: string;
  exported_by: { user_id: string; email: string };
  data_classes: { yours: string; source: string; ai: string };
  truncated: string[];
  workspace: ExportWorkspace & { created_at: string };
  members: ExportMember[];
  counts: { saved_funders: number; tasks: number; activities: number; stage_history: number };
  saved_funders: ExportSavedFunder[];
  tasks: ExportTask[];
  activities: ExportActivity[];
  stage_history: ExportStageHistory[];
};

function iso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function isoDateOnly(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const s = iso(value);
  return s ? s.slice(0, 10) : null;
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalise rows (postgres.js hands back Date objects and numeric strings) into stable JSON. */
export function buildWorkspaceExport(input: WorkspaceExportInput): WorkspaceExport {
  const exportedAt = input.exported_at ?? new Date();
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    generator: "getfunded",
    exported_at: exportedAt.toISOString(),
    exported_by: input.exported_by,
    data_classes: {
      yours: "Everything in this archive is your workspace's own data (saved funders, pipeline, tasks, notes).",
      source: "Funder snapshots name the public IRS record (org_id, name, EIN). Re-fetch filings from the Open Funder Database.",
      ai: "Rows whose kind or meta is marked ai were machine-suggested and are not facts.",
    },
    truncated: input.truncated ?? [],
    workspace: {
      id: input.workspace.id,
      slug: input.workspace.slug,
      name: input.workspace.name,
      plan: input.workspace.plan,
      profile: input.workspace.profile ?? {},
      settings: input.workspace.settings ?? {},
      created_at: iso(input.workspace.created_at) ?? exportedAt.toISOString(),
    },
    members: input.members.map((m) => ({
      user_id: m.user_id,
      role: m.role,
      email: m.email ?? null,
      display_name: m.display_name ?? null,
      joined_at: iso(m.joined_at) ?? "",
    })),
    counts: {
      saved_funders: input.saved_funders.length,
      tasks: input.tasks.length,
      activities: input.activities.length,
      stage_history: input.stage_history.length,
    },
    saved_funders: input.saved_funders.map((f) => ({
      id: f.id,
      org_id: f.org_id,
      snapshot: f.snapshot ?? {},
      stage: f.stage,
      tier: f.tier ?? null,
      owner_id: f.owner_id ?? null,
      ask_amount: toNumberOrNull(f.ask_amount),
      next_action: f.next_action ?? null,
      next_action_due: isoDateOnly(f.next_action_due),
      source_detail: f.source_detail ?? null,
      tags: f.tags ?? [],
      archived_at: iso(f.archived_at),
      created_at: iso(f.created_at) ?? "",
      updated_at: iso(f.updated_at) ?? "",
    })),
    tasks: input.tasks.map((t) => ({
      id: t.id,
      saved_funder_id: t.saved_funder_id ?? null,
      title: t.title,
      details: t.details ?? null,
      due_date: isoDateOnly(t.due_date),
      assignee_id: t.assignee_id ?? null,
      status: t.status,
      completed_at: iso(t.completed_at),
      created_by: t.created_by ?? null,
      created_at: iso(t.created_at) ?? "",
      updated_at: iso(t.updated_at) ?? "",
    })),
    activities: input.activities.map((a) => ({
      id: a.id,
      saved_funder_id: a.saved_funder_id ?? null,
      kind: a.kind,
      body: a.body ?? "",
      occurred_at: iso(a.occurred_at) ?? "",
      created_by: a.created_by ?? null,
      meta: a.meta ?? {},
      created_at: iso(a.created_at) ?? "",
    })),
    stage_history: input.stage_history.map((h) => ({
      id: typeof h.id === "string" ? Number(h.id) : h.id,
      saved_funder_id: h.saved_funder_id,
      from_stage: h.from_stage ?? null,
      to_stage: h.to_stage,
      changed_by: h.changed_by ?? null,
      note: h.note ?? null,
      created_at: iso(h.created_at) ?? "",
    })),
  };
}

export const EXPORT_FILES = [
  "README.txt",
  "workspace.json",
  "members.json",
  "saved_funders.json",
  "tasks.json",
  "activities.json",
  "stage_history.json",
] as const;

function readme(data: WorkspaceExport): string {
  const lines = [
    `GetFunded workspace export: ${data.workspace.name}`,
    `Exported ${data.exported_at} by ${data.exported_by.email}`,
    `Schema version ${data.schema_version}`,
    "",
    "Files",
    "  workspace.json      name, plan, organization profile, settings",
    "  members.json        who is in the workspace and their role",
    "  saved_funders.json  your saved funders with stage, tier, owner, ask and tags",
    "  tasks.json          tasks, due dates and status",
    "  activities.json     notes, calls, meetings, emails and system events",
    "  stage_history.json  every pipeline stage change",
    "",
    "What is and is not here",
    "  Everything in this archive is your own workspace data.",
    "  Funder snapshots carry the public IRS identity (org_id, name, EIN) so you can",
    "  match them back to the Open Funder Database. Filings themselves are public and",
    "  are not copied here.",
    "  Rows marked ai were machine-suggested and are not facts.",
    "",
    "Dates are ISO 8601 in UTC. Money is whole US dollars.",
  ];
  if (data.truncated.length > 0) {
    lines.push("", `Note: ${data.truncated.join(", ")} were cut at ${EXPORT_ROW_CAP.toLocaleString("en-US")} rows each.`);
  }
  return `${lines.join("\n")}\n`;
}

/** The ZIP entries for an export: one JSON file per table plus a README. */
export function exportEntries(data: WorkspaceExport): ZipEntry[] {
  const mtime = new Date(data.exported_at);
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const { saved_funders, tasks, activities, stage_history, members, ...manifest } = data;
  return [
    { name: "README.txt", data: readme(data), mtime },
    { name: "workspace.json", data: json(manifest), mtime },
    { name: "members.json", data: json(members), mtime },
    { name: "saved_funders.json", data: json(saved_funders), mtime },
    { name: "tasks.json", data: json(tasks), mtime },
    { name: "activities.json", data: json(activities), mtime },
    { name: "stage_history.json", data: json(stage_history), mtime },
  ];
}

export function exportZip(data: WorkspaceExport): Uint8Array<ArrayBuffer> {
  return createZip(exportEntries(data), new Date(data.exported_at));
}

/** `getfunded-<slug>-<YYYY-MM-DD>.zip` */
export function exportFilename(slug: string, exportedAt: Date): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  return `getfunded-${safe}-${exportedAt.toISOString().slice(0, 10)}.zip`;
}

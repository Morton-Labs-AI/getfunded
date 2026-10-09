import "server-only";

import { z } from "zod";

import { readSignalsForOrgs, type FunderSignal } from "@/lib/queries/corpus/signals";

import { int, iso, run, text, type Deps } from "./sql";
import type { WorkspaceCtx } from "./types";

/**
 * Notifications and notification preferences (migration getfunded_0016).
 *
 *  - Rows are written only by the door `getfunded.sync_signal_notifications()`
 *    (the scheduler, /api/cron/signals). The app reads them and flips
 *    `read_at` / `dismissed_at`; RLS scopes every statement to the signed-in
 *    person.
 *  - Preferences are per person per workspace, upserted by the person.
 *  - `signalsForSavedFunders` is the dashboard's cross-plane read: the
 *    workspace's live saved org ids, then the corpus signals about them.
 */

export type NotificationKind = "funder_signal" | "signal_discovery" | "system";

export type NotificationReason = { code: string; label: string };

export type Notification = {
  id: number;
  kind: NotificationKind;
  signalId: number | null;
  orgId: string | null;
  savedFunderId: string | null;
  title: string;
  body: string | null;
  href: string;
  score: number;
  reasons: NotificationReason[];
  readAt: string | null;
  createdAt: string;
};

export type NotificationPreferences = {
  signalAlerts: boolean;
  discoveryAlerts: boolean;
  minScore: number;
  emailDigest: "off" | "daily" | "weekly";
  version: number;
  /** False when the person has never saved preferences (defaults shown). */
  saved: boolean;
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  signalAlerts: true,
  discoveryAlerts: true,
  minScore: 50,
  emailDigest: "off",
  version: 0,
  saved: false,
};

export const preferencesSchema = z.object({
  signalAlerts: z.boolean(),
  discoveryAlerts: z.boolean(),
  minScore: z.number().int().min(0).max(100),
  emailDigest: z.enum(["off", "daily", "weekly"]),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

function reasons(value: unknown): NotificationReason[] {
  if (!Array.isArray(value)) return [];
  const out: NotificationReason[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && typeof (item as { code?: unknown }).code === "string") {
      const code = (item as { code: string }).code;
      const label = typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label : code;
      out.push({ code, label });
    }
  }
  return out;
}

function isKind(v: unknown): v is NotificationKind {
  return v === "funder_signal" || v === "signal_discovery" || v === "system";
}

type Row = Record<string, unknown>;

function toNotification(r: Row): Notification {
  return {
    id: int(r.id),
    kind: isKind(r.kind) ? r.kind : "system",
    signalId: r.signal_id === null || r.signal_id === undefined ? null : int(r.signal_id),
    orgId: text(r.org_id),
    savedFunderId: text(r.saved_funder_id),
    title: text(r.title) ?? "",
    body: text(r.body),
    href: text(r.href) ?? "/app",
    score: int(r.score),
    reasons: reasons(r.reasons),
    readAt: iso(r.read_at),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  };
}

/** The signed-in person's notifications in this workspace, newest first. */
export async function listNotifications(
  ctx: WorkspaceCtx,
  opts: { unreadOnly?: boolean; limit?: number } = {},
  deps?: Deps,
): Promise<Notification[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return run(ctx, deps, async (sql) => {
    const rows = await sql<Row[]>`
      select n.id::text as id, n.kind, n.signal_id::text as signal_id, n.org_id::text as org_id,
             n.saved_funder_id::text as saved_funder_id, n.title, n.body, n.href, n.score, n.reasons,
             n.read_at, n.created_at
      from getfunded.notifications n
      where n.workspace_id = ${ctx.workspaceId} and n.user_id = ${ctx.userId}
        and n.dismissed_at is null
        ${opts.unreadOnly ? sql`and n.read_at is null` : sql``}
      order by n.created_at desc, n.id desc
      limit ${limit}`;
    return rows.map(toNotification);
  });
}

export async function unreadNotificationCount(ctx: WorkspaceCtx, deps?: Deps): Promise<number> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n from getfunded.notifications
      where workspace_id = ${ctx.workspaceId} and user_id = ${ctx.userId}
        and read_at is null and dismissed_at is null`;
    return int(rows[0]?.n);
  });
}

export const markReadSchema = z
  .object({
    ids: z.array(z.number().int().positive()).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => (v.ids && v.ids.length > 0) || v.all === true, { message: "Nothing to mark." });

/** Mark some or all of the person's notifications read. Returns rows changed. */
export async function markNotificationsRead(
  ctx: WorkspaceCtx,
  input: z.infer<typeof markReadSchema>,
  deps?: Deps,
): Promise<number> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      update getfunded.notifications
         set read_at = now()
       where workspace_id = ${ctx.workspaceId} and user_id = ${ctx.userId} and read_at is null
         ${input.all ? sql`` : sql`and id = any(${(input.ids ?? []).map(String)}::bigint[])`}
       returning id`;
    return rows.length;
  });
}

export async function dismissNotification(ctx: WorkspaceCtx, id: number, deps?: Deps): Promise<boolean> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ id: string }[]>`
      update getfunded.notifications
         set dismissed_at = now(), read_at = coalesce(read_at, now())
       where workspace_id = ${ctx.workspaceId} and user_id = ${ctx.userId} and id = ${String(id)}::bigint
       returning id`;
    return rows.length > 0;
  });
}

export async function getNotificationPreferences(ctx: WorkspaceCtx, deps?: Deps): Promise<NotificationPreferences> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<Row[]>`
      select signal_alerts, discovery_alerts, min_score, email_digest, version
      from getfunded.notification_preferences
      where workspace_id = ${ctx.workspaceId} and user_id = ${ctx.userId}`;
    const r = rows[0];
    if (!r) return DEFAULT_PREFERENCES;
    const digest = text(r.email_digest);
    return {
      signalAlerts: r.signal_alerts === true,
      discoveryAlerts: r.discovery_alerts === true,
      minScore: int(r.min_score, 50),
      emailDigest: digest === "daily" || digest === "weekly" ? digest : "off",
      version: int(r.version, 1),
      saved: true,
    };
  });
}

/** Upsert the person's preferences. Last write wins; this is per-person UI state, not shared data. */
export async function saveNotificationPreferences(
  ctx: WorkspaceCtx,
  input: PreferencesInput,
  deps?: Deps,
): Promise<NotificationPreferences> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<Row[]>`
      insert into getfunded.notification_preferences
        (workspace_id, user_id, signal_alerts, discovery_alerts, min_score, email_digest)
      values (${ctx.workspaceId}, ${ctx.userId}, ${input.signalAlerts}, ${input.discoveryAlerts},
              ${input.minScore}, ${input.emailDigest})
      on conflict (workspace_id, user_id) do update set
        signal_alerts = excluded.signal_alerts,
        discovery_alerts = excluded.discovery_alerts,
        min_score = excluded.min_score,
        email_digest = excluded.email_digest,
        version = getfunded.notification_preferences.version + 1
      returning signal_alerts, discovery_alerts, min_score, email_digest, version`;
    const r = rows[0];
    return {
      signalAlerts: r?.signal_alerts === true,
      discoveryAlerts: r?.discovery_alerts === true,
      minScore: int(r?.min_score, 50),
      emailDigest: input.emailDigest,
      version: int(r?.version, 1),
      saved: true,
    };
  });
}

/**
 * Recent published signals about the workspace's live saved funders, for the
 * dashboard. One transaction: the saved org ids under RLS, then the corpus
 * read on the same connection.
 */
export async function signalsForSavedFunders(ctx: WorkspaceCtx, limit = 6, deps?: Deps): Promise<FunderSignal[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ org_id: string }[]>`
      select org_id::text as org_id from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId} and archived_at is null
      limit 500`;
    return readSignalsForOrgs(
      sql,
      rows.map((r) => r.org_id),
      limit,
    );
  });
}

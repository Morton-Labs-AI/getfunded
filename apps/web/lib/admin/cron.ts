/**
 * /api/cron/daily helpers. `authorizeCron` is pure; `runDailyMaintenance`
 * calls the `getfunded.daily_maintenance()` door with no user (the cron has
 * none; the door is SECURITY DEFINER) through the injectable `sql` seam. The
 * door prunes old events, fails stale sends and (since migration 0011)
 * refunds usage_ledger rows stuck in 'reserved' for over an hour.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import type { Db } from "@/lib/billing/db";

export type Env = Record<string, string | undefined>;

export type CronAuth =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: "cron_not_configured" | "unauthorized"; message: string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** `Authorization: Bearer <secret>` (what Vercel Cron sends) or `x-cron-secret: <secret>`. */
export function cronSecretFrom(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^bearer\s+(.+)$/i.exec(auth.trim());
    if (m && m[1]?.trim()) return m[1].trim();
  }
  const header = req.headers.get("x-cron-secret");
  return header?.trim() ? header.trim() : null;
}

/**
 * 503 when CRON_SECRET is unset (the job refuses to run unprotected), 401 when
 * the presented secret is missing or wrong. Constant-time compare on digests.
 */
export function authorizeCron(req: Request, env: Env = process.env): CronAuth {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) {
    return { ok: false, status: 503, code: "cron_not_configured", message: "CRON_SECRET is not set, so scheduled jobs are off." };
  }
  const presented = cronSecretFrom(req);
  if (!presented || !timingSafeEqual(digest(presented), digest(secret))) {
    return { ok: false, status: 401, code: "unauthorized", message: "This endpoint is for the scheduler." };
  }
  return { ok: true };
}

export type MaintenanceResult = {
  eventsPruned: number;
  sendsFailed: number;
  /** usage_ledger rows left 'reserved' for over an hour, refunded by the door (migration 0011). */
  ledgerReaped: number;
  ranAt: string;
};

export type MaintenanceOptions = {
  /** Postgres interval text. Defaults match the door's two-argument form. */
  eventRetention?: string;
  staleSendAfter?: string;
  /** How long a usage_ledger row may stay 'reserved' before it is refunded as abandoned (door minimum: 10 minutes). */
  staleReservationAfter?: string;
};

export async function runDailyMaintenance(sql: Db, opts: MaintenanceOptions = {}): Promise<MaintenanceResult> {
  const retention = opts.eventRetention ?? "12 months";
  const stale = opts.staleSendAfter ?? "1 hour";
  const staleReservation = opts.staleReservationAfter ?? "1 hour";
  const rows = await sql<{ events_pruned: number | string; sends_failed: number | string; ledger_reaped?: number | string | null }[]>`
    select events_pruned, sends_failed, ledger_reaped
    from getfunded.daily_maintenance(${retention}::interval, ${stale}::interval, ${staleReservation}::interval)`;
  const row = rows[0];
  return {
    eventsPruned: Number(row?.events_pruned ?? 0),
    sendsFailed: Number(row?.sends_failed ?? 0),
    ledgerReaped: Number(row?.ledger_reaped ?? 0),
    ranAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------- signals */

export type SignalSyncResult = {
  workspacesScanned: number;
  signalsSeen: number;
  notificationsCreated: number;
  activitiesLogged: number;
  ranAt: string;
};

export type SignalSyncOptions = {
  /** Signals per workspace per run (door bound: 1..5000). */
  limit?: number;
  /** Discovery alerts for every workspace regardless of plan (a self-install). */
  discoveryForAll?: boolean;
};

/**
 * Calls `getfunded.sync_signal_notifications()` (migration getfunded_0016)
 * with no user: new published corpus signals become notifications for the
 * people they concern, and a system activity on each saved funder. Idempotent
 * through per-workspace cursors; a second run creates nothing.
 */
export async function runSignalSync(sql: Db, opts: SignalSyncOptions = {}): Promise<SignalSyncResult> {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const rows = await sql<
    { workspaces_scanned: number | string; signals_seen: number | string; notifications_created: number | string; activities_logged: number | string }[]
  >`
    select workspaces_scanned, signals_seen, notifications_created, activities_logged
    from getfunded.sync_signal_notifications(${limit}::int, ${opts.discoveryForAll ?? false}::boolean)`;
  const row = rows[0];
  return {
    workspacesScanned: Number(row?.workspaces_scanned ?? 0),
    signalsSeen: Number(row?.signals_seen ?? 0),
    notificationsCreated: Number(row?.notifications_created ?? 0),
    activitiesLogged: Number(row?.activities_logged ?? 0),
    ranAt: new Date().toISOString(),
  };
}

/**
 * "Today's focus": one ranked list of what needs a person next, built from
 * data the workspace already writes (tasks, next actions, activity). Nothing
 * here is estimated or machine-suggested; every item points at a row the
 * user or their team created, so it renders as YOURS, never AI.
 *
 * Pure and deterministic given `now`, so it is unit tested without a database.
 */
import { ACTIVE_STAGES, CONVERSATION_STAGES, type Stage } from "./stages";

export type FocusKind = "overdue_task" | "task_due_today" | "next_action" | "never_contacted" | "stale";

export type FocusItem = {
  /** Stable, unique across kinds: `${kind}:${rowId}`. */
  id: string;
  kind: FocusKind;
  title: string;
  /** One plain sentence of context: who, what stage, how late. */
  subtitle: string;
  href: string;
  /** Higher sorts first. */
  score: number;
  savedFunderId: string | null;
  dueDate: string | null;
};

export type FocusTask = {
  id: string;
  title: string;
  dueDate: string | null;
  status: "open" | "done" | "canceled";
  savedFunderId: string | null;
  funderName: string | null;
  orgId: string | null;
  assigneeName: string | null;
};

export type FocusFunder = {
  id: string;
  orgId: string;
  name: string;
  stage: Stage;
  nextAction: string | null;
  nextActionDue: string | null;
  lastTouchAt: string | null;
  createdAt: string;
  ownerName: string | null;
  askAmount: number | null;
};

export type FocusInput = {
  tasks: ReadonlyArray<FocusTask>;
  funders: ReadonlyArray<FocusFunder>;
  now: Date;
  limit?: number;
};

/** Days until `date` (negative when it has passed), on calendar days in UTC. */
export function daysUntil(dateYmd: string, now: Date): number {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const target = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

export function daysSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

const STALE_AFTER_DAYS = 30;
const NEVER_CONTACTED_AFTER_DAYS = 3;

function lateText(days: number): string {
  if (days === 0) return "due today";
  if (days === 1) return "1 day overdue";
  return `${days} days overdue`;
}

function soonText(days: number): string {
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

/**
 * Rank order, highest first:
 *   1. overdue tasks (older is worse)
 *   2. tasks due today
 *   3. next actions that are overdue, then due within 7 days
 *   4. funders saved more than 3 days ago that nobody has contacted
 *   5. funders in an active stage with no logged contact for 30+ days
 * Ties break on the planned ask (bigger first), then the name.
 */
export function rankFocus({ tasks, funders, now, limit = 8 }: FocusInput): FocusItem[] {
  const items: FocusItem[] = [];

  for (const t of tasks) {
    if (t.status !== "open" || !t.dueDate) continue;
    const days = daysUntil(t.dueDate, now);
    if (days > 0) continue;
    const overdue = -days;
    const where = t.funderName ? ` · ${t.funderName}` : "";
    const who = t.assigneeName ? ` · ${t.assigneeName}` : "";
    const href = t.orgId ? `/app/funders/${t.orgId}` : "/app/tasks?view=overdue";
    if (overdue > 0) {
      items.push({
        id: `overdue_task:${t.id}`,
        kind: "overdue_task",
        title: t.title,
        subtitle: `Task ${lateText(overdue)}${where}${who}`,
        href,
        score: 1000 + Math.min(overdue, 365),
        savedFunderId: t.savedFunderId,
        dueDate: t.dueDate,
      });
    } else {
      items.push({
        id: `task_due_today:${t.id}`,
        kind: "task_due_today",
        title: t.title,
        subtitle: `Task due today${where}${who}`,
        href,
        score: 800,
        savedFunderId: t.savedFunderId,
        dueDate: t.dueDate,
      });
    }
  }

  for (const f of funders) {
    const ask = f.askAmount ?? 0;
    const tieBreak = Math.min(ask / 1_000_000, 0.9);
    const owner = f.ownerName ? ` · ${f.ownerName}` : "";
    const href = `/app/funders/${f.orgId}`;

    if (f.nextActionDue) {
      const days = daysUntil(f.nextActionDue, now);
      if (days <= 7) {
        const overdue = days < 0;
        items.push({
          id: `next_action:${f.id}`,
          kind: "next_action",
          title: f.nextAction ? `${f.nextAction} · ${f.name}` : `Next step for ${f.name}`,
          subtitle: `${overdue ? lateText(-days) : soonText(days)}${owner}`,
          href,
          score: (overdue ? 700 + Math.min(-days, 90) : 500 - days) + tieBreak,
          savedFunderId: f.id,
          dueDate: f.nextActionDue,
        });
        continue;
      }
    }

    const exit = f.stage === "declined" || f.stage === "parked" || f.stage === "awarded";
    if (exit) continue;

    if (f.lastTouchAt === null) {
      const age = daysSince(f.createdAt, now);
      if (age >= NEVER_CONTACTED_AFTER_DAYS) {
        items.push({
          id: `never_contacted:${f.id}`,
          kind: "never_contacted",
          title: f.name,
          subtitle: `Saved ${age} days ago, never contacted${owner}`,
          href,
          score: 300 + Math.min(age, 60) + tieBreak,
          savedFunderId: f.id,
          dueDate: null,
        });
      }
      continue;
    }

    if ((ACTIVE_STAGES as readonly string[]).includes(f.stage)) {
      const quiet = daysSince(f.lastTouchAt, now);
      if (quiet >= STALE_AFTER_DAYS) {
        const inConversation = (CONVERSATION_STAGES as readonly string[]).includes(f.stage);
        items.push({
          id: `stale:${f.id}`,
          kind: "stale",
          title: f.name,
          subtitle: `No contact logged for ${quiet} days${owner}`,
          href,
          score: 200 + (inConversation ? 50 : 0) + Math.min(quiet - STALE_AFTER_DAYS, 90) + tieBreak,
          savedFunderId: f.id,
          dueDate: null,
        });
      }
    }
  }

  // Keep one line per funder for funder-level reasons; tasks stay separate.
  const seen = new Set<string>();
  const sorted = items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const out: FocusItem[] = [];
  for (const item of sorted) {
    if (item.kind !== "overdue_task" && item.kind !== "task_due_today" && item.savedFunderId) {
      if (seen.has(item.savedFunderId)) continue;
      seen.add(item.savedFunderId);
    }
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

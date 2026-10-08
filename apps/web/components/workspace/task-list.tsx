"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { setTaskStatusAction } from "@/lib/workspace/actions";
import type { Task } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The task list. Completing a task linked to a funder writes "Task done: …"
 * to that funder's timeline (lib/workspace/tasks.ts), so the list and the
 * timeline never disagree.
 */
export function TaskList({ tasks, compact = false }: { tasks: Task[]; compact?: boolean }) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  const today = todayYmd();

  function setStatus(task: Task, status: "open" | "done" | "canceled") {
    setPendingId(task.id);
    startTransition(async () => {
      try {
        const r = await setTaskStatusAction({ id: task.id, version: task.version, status });
        if (!r.ok) {
          if (r.code === "stale") {
            toast.warning("Changed somewhere else", { description: r.message });
            router.refresh();
          } else {
            toast.error("Could not update the task", { description: r.message });
          }
          return;
        }
        if (status === "done") toast.success("Done", { description: task.title });
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <ul className="divide-y rounded-lg border bg-card shadow-card">
      {tasks.map((t) => {
        const overdue = t.status === "open" && t.dueDate !== null && t.dueDate < today;
        const dueToday = t.status === "open" && t.dueDate === today;
        const busy = pendingId === t.id;
        return (
          <li key={t.id} className={cn("flex items-start gap-3 px-3 py-2.5 sm:items-center", busy && "opacity-70")}>
            <button
              type="button"
              aria-label={t.status === "done" ? `Reopen ${t.title}` : `Mark ${t.title} done`}
              disabled={busy || t.status === "canceled"}
              onClick={() => setStatus(t, t.status === "done" ? "open" : "done")}
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-150 sm:mt-0",
                t.status === "done"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border-strong text-transparent hover:border-primary hover:text-primary",
              )}
            >
              <Check className="size-3" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", t.status === "done" ? "text-ink-4 line-through" : t.status === "canceled" ? "text-ink-4" : "text-foreground")}>
                {t.title}
              </p>
              <p className="flex flex-wrap gap-x-2 text-xs text-ink-3">
                {t.funderName && t.orgId ? (
                  <Link href={`/app/funders/${t.orgId}`} className="text-primary hover:underline">
                    {t.funderName}
                  </Link>
                ) : null}
                {t.assigneeName ? <span>{t.assigneeName}</span> : null}
                {t.status === "canceled" ? <span>Canceled</span> : null}
                {!compact && t.details ? <span className="line-clamp-1 basis-full text-ink-3">{t.details}</span> : null}
              </p>
            </div>
            {t.dueDate ? (
              <span className={cn("tnum shrink-0 text-xs", overdue ? "font-semibold text-danger" : dueToday ? "font-semibold text-warning" : "text-ink-3")}>
                {overdue ? "Overdue · " : dueToday ? "Today · " : ""}
                {formatDate(t.dueDate)}
              </span>
            ) : null}
            {t.status === "open" ? (
              <Button variant="ghost" size="icon-sm" aria-label={`Cancel ${t.title}`} title="Cancel task" disabled={busy} onClick={() => setStatus(t, "canceled")}>
                <X />
              </Button>
            ) : t.status === "canceled" ? (
              <Button variant="ghost" size="icon-sm" aria-label={`Reopen ${t.title}`} title="Reopen" disabled={busy} onClick={() => setStatus(t, "open")}>
                <RotateCcw />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

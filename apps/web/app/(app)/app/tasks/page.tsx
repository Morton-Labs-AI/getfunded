import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageBody, PageHeader } from "@/components/workspace/page-header";
import { TaskDialog } from "@/components/workspace/task-dialog";
import { TaskList } from "@/components/workspace/task-list";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { TASK_VIEWS, parseTaskView, taskViewHref, type RawParams } from "@/lib/workspace/filters";
import { listMembers } from "@/lib/workspace/members";
import { softFail } from "@/lib/workspace/safe";
import { listTasks, taskCounts, type TaskCounts } from "@/lib/workspace/tasks";
import type { TaskView, WorkspaceCtx } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: WORKSPACE_COPY.tasks.title };

type Props = { searchParams: Promise<RawParams> };

/**
 * Tasks, soonest first. The view (`?view=`) is a link so a person can
 * bookmark "Overdue". Completing a task linked to a funder writes to that
 * funder's timeline, so the two never disagree.
 */
export default function TasksPage({ searchParams }: Props) {
  return (
    <PageBody>
      <Suspense fallback={<TasksSkeleton />}>
        <TasksContent searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

async function TasksContent({ searchParams }: Props) {
  const [sp, { user, workspace }] = await Promise.all([searchParams, requireWorkspace()]);
  const view = parseTaskView(sp.view);
  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };

  const [tasks, members, counts] = await Promise.all([
    softFail("tasks", null, () => listTasks(ctx, view)),
    softFail("members", [], () => listMembers(ctx)),
    softFail("task counts", null, () => taskCounts(ctx)),
  ]);

  const newTask = <TaskDialog members={members} currentUserId={user.id} />;

  return (
    <>
      <PageHeader eyebrow={WORKSPACE_COPY.yours.label} title={WORKSPACE_COPY.tasks.title} subtitle={WORKSPACE_COPY.tasks.subtitle} actions={newTask} />

      <ViewTabs current={view} counts={counts} />

      <div className="mt-4 max-w-3xl">
        {tasks === null ? (
          <EmptyState
            tone="problem"
            title="We could not load your tasks right now"
            hint="The connection to the database dropped. Wait a moment and reload the page. Nothing has been lost."
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            title={view === "overdue" ? WORKSPACE_COPY.tasks.clean : view === "done" ? "Nothing finished yet" : WORKSPACE_COPY.tasks.empty}
            hint={view === "done" ? "Tasks you mark done show up here." : WORKSPACE_COPY.tasks.emptyHint}
            action={view === "done" ? undefined : newTask}
          />
        ) : (
          <TaskList tasks={tasks} />
        )}
      </div>
    </>
  );
}

function countFor(view: TaskView, counts: TaskCounts | null): number | null {
  if (!counts) return null;
  switch (view) {
    case "open":
      return counts.open;
    case "mine":
      return counts.mine;
    case "today":
      return counts.overdue + counts.dueToday;
    case "overdue":
      return counts.overdue;
    default:
      return null;
  }
}

function ViewTabs({ current, counts }: { current: TaskView; counts: TaskCounts | null }) {
  return (
    <nav aria-label="Task views" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-md bg-muted p-1">
        {TASK_VIEWS.map((t) => {
          const active = t.key === current;
          const n = countFor(t.key, counts);
          return (
            <li key={t.key}>
              <Link
                href={taskViewHref(t.key)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "bg-surface text-foreground shadow-sm" : "text-ink-3 hover:text-foreground",
                )}
              >
                {t.label}
                {n !== null && n > 0 ? (
                  <span className={cn("tnum rounded-full px-1.5 text-[11px]", t.key === "overdue" ? "bg-danger-tint text-danger" : "bg-inset text-ink-3")}>
                    {n}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TasksSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading tasks">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-2 h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <Skeleton className="mt-6 h-10 w-96 max-w-full" />
      <div className="mt-4 max-w-3xl rounded-lg border bg-card">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="m-3 h-10" />
        ))}
      </div>
    </div>
  );
}

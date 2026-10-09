import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Bookmark, CalendarClock, Coins, Handshake, MessageSquare, Search, SquareCheck, Target, Upload } from "lucide-react";

import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { StatTile, type StatTrend } from "@/components/data/stat-tile";
import { YoursTag } from "@/components/data/yours-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityTimeline } from "@/components/workspace/activity-timeline";
import { FunnelBars } from "@/components/workspace/funnel-bars";
import { EmptyState, PageBody, PageHeader, SectionTitle } from "@/components/workspace/page-header";
import { QuickAdd } from "@/components/workspace/quick-add";
import { SignalsPanel } from "@/components/workspace/signals-panel";
import { getUsage, type UsageSummary } from "@/lib/billing/meter";
import { formatDate, formatNumber } from "@/lib/format";
import { recentActivities } from "@/lib/workspace/activities";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { kpis, momentum, ownerLoad, pipelineFunnel, todaysFocus, type Momentum } from "@/lib/workspace/dashboard";
import type { FocusItem, FocusKind } from "@/lib/workspace/focus";
import { listMembers } from "@/lib/workspace/members";
import { signalsForSavedFunders } from "@/lib/workspace/notifications";
import { softFail } from "@/lib/workspace/safe";
import { taskCounts } from "@/lib/workspace/tasks";
import type { WorkspaceCtx } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The dashboard: what needs a person today, where the pipeline stands, and
 * how much AI credit is left. Every number comes from rows the workspace
 * wrote; nothing here is estimated. The copy says what each figure is.
 */
export default function DashboardPage() {
  return (
    <PageBody>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </PageBody>
  );
}

async function DashboardContent() {
  const { user, workspace } = await requireWorkspace();
  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };
  const now = new Date();

  const [focus, funnel, mom, k, counts, load, members, recent, usage, signals] = await Promise.all([
    softFail("today's focus", [], () => todaysFocus(ctx, now)),
    softFail("funnel", [], () => pipelineFunnel(ctx)),
    softFail("momentum", null, () => momentum(ctx)),
    softFail("kpis", null, () => kpis(ctx)),
    softFail("task counts", null, () => taskCounts(ctx)),
    softFail("owner load", [], () => ownerLoad(ctx)),
    softFail("members", [], () => listMembers(ctx)),
    softFail("recent activity", [], () => recentActivities(ctx, 10)),
    softFail("usage", null, () => getUsage(workspace.id, user.id)),
    softFail("signals", [], () => signalsForSavedFunders(ctx, 6)),
  ]);

  const firstName = (user.displayName ?? "").trim().split(/\s+/)[0] || null;
  const empty = k !== null && k.saved === 0;

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title={firstName ? `Welcome back, ${firstName}` : "Your dashboard"}
        subtitle="Where your funder work stands and what needs you today."
        actions={<QuickAdd members={members} currentUserId={user.id} />}
      />

      {empty ? <GettingStarted /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Planned asks"
          value={k?.pipelineAsk ? <Money value={k.pipelineAsk} compact mono={false} /> : <Missing bare />}
          hint="Working figures, not money raised"
          href="/app/pipeline"
          icon={Target}
        />
        <StatTile
          label="Funders on your list"
          value={k ? formatNumber(k.saved) : <Missing bare />}
          hint={k ? `${k.tier1} marked Tier 1` : undefined}
          trend={mom ? delta(mom.added30, mom.addedPrev30) : undefined}
          href="/app/saved"
          icon={Bookmark}
        />
        <StatTile
          label="In conversation"
          value={k ? formatNumber(k.inConversation) : <Missing bare />}
          hint="Cultivating, LOI or proposal in"
          href="/app/pipeline"
          icon={Handshake}
        />
        <StatTile
          label="Contacts logged"
          value={mom ? formatNumber(mom.touches30) : <Missing bare />}
          hint="Calls, emails, meetings, last 30 days"
          trend={mom ? delta(mom.touches30, mom.touchesPrev30) : undefined}
          icon={MessageSquare}
        />
        <StatTile
          label="Follow-ups due"
          value={k ? formatNumber(k.followUpsDue7) : <Missing bare />}
          hint="Next actions due in 7 days"
          href="/app/saved?sort=due"
          icon={CalendarClock}
        />
        <StatTile
          label="Tasks due"
          value={counts ? formatNumber(counts.overdue + counts.dueToday) : <Missing bare />}
          hint={counts && counts.overdue > 0 ? `${counts.overdue} overdue` : "Today or overdue"}
          href="/app/tasks?view=today"
          icon={SquareCheck}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Panel>
            <SectionTitle hint={WORKSPACE_COPY.dashboard.focusHint} action={<YoursTag />}>
              {WORKSPACE_COPY.dashboard.focusTitle}
            </SectionTitle>
            <FocusList items={focus} />
          </Panel>

          <Panel>
            <SectionTitle
              hint="How many funders reached each stage or went further, and how many sit there today."
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/app/pipeline">
                    Open the board
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              }
            >
              Pipeline
            </SectionTitle>
            {funnel.length === 0 || funnel.every((r) => r.reached === 0) ? (
              <EmptyState
                title={WORKSPACE_COPY.pipeline.empty}
                hint={WORKSPACE_COPY.pipeline.emptyHint}
                action={
                  <Button asChild size="sm">
                    <Link href="/app/search">
                      <Search aria-hidden />
                      Find funders
                    </Link>
                  </Button>
                }
              />
            ) : (
              <FunnelBars rows={funnel} />
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel>
            <SectionTitle hint="Last 30 days against the 30 before.">Momentum</SectionTitle>
            {mom ? <MomentumList m={mom} /> : <Missing />}
          </Panel>

          <Panel>
            <SectionTitle hint="Only calls to a language model cost credits. Search is always free.">AI credits</SectionTitle>
            {usage ? <CreditsUsed usage={usage} /> : <Missing />}
          </Panel>

          {load.length > 0 ? (
            <Panel>
              <SectionTitle hint="Funders owned, by person.">Who carries what</SectionTitle>
              <ul className="flex flex-col gap-2.5">
                {load.map((r) => (
                  <li key={r.userId ?? "unassigned"} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", r.userId ? "text-foreground" : "italic text-warning")}>{r.name}</span>
                      <span className="tnum shrink-0 text-xs text-ink-3">
                        {r.funders} {r.funders === 1 ? "funder" : "funders"}
                        {r.askTotal !== null ? (
                          <>
                            {" · "}
                            <Money value={r.askTotal} compact mono={false} />
                          </>
                        ) : null}
                      </span>
                    </div>
                    {r.overdueTasks > 0 ? (
                      <span className="text-xs text-danger">
                        {r.overdueTasks} overdue {r.overdueTasks === 1 ? "task" : "tasks"}
                      </span>
                    ) : r.openTasks > 0 ? (
                      <span className="text-xs text-ink-3">
                        {r.openTasks} open {r.openTasks === 1 ? "task" : "tasks"}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <SectionTitle
              hint="What funders on your list have announced, from their own newsrooms."
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/app/notifications">
                    Alerts
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
              }
            >
              Funder signals
            </SectionTitle>
            <SignalsPanel signals={signals} />
          </Panel>

          <Panel>
            <SectionTitle hint="Everything the team has logged, newest first.">Latest activity</SectionTitle>
            {recent.length === 0 ? (
              <p className="text-sm text-ink-3">Quiet so far. Saves, notes and stage moves show up here as your team works.</p>
            ) : (
              <ActivityTimeline activities={recent} showFunder />
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- pieces */

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border bg-card p-4 shadow-card sm:p-5">{children}</section>;
}

function delta(now: number, prev: number): StatTrend {
  return { value: now - prev, label: "vs prior 30 days", format: "number" };
}

const FOCUS_LABEL: Record<FocusKind, { label: string; variant: "danger" | "warning" | "secondary" | "outline" }> = {
  overdue_task: { label: "Overdue task", variant: "danger" },
  task_due_today: { label: "Due today", variant: "warning" },
  next_action: { label: "Next step", variant: "secondary" },
  never_contacted: { label: "Never contacted", variant: "warning" },
  stale: { label: "Going quiet", variant: "outline" },
};

function FocusList({ items }: { items: FocusItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title={WORKSPACE_COPY.dashboard.allClear}
        hint="Nothing is overdue and no funder has gone quiet. Search for new funders or import a list you already keep."
        action={
          <Button asChild size="sm">
            <Link href="/app/search">
              <Search aria-hidden />
              Find funders
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <ol className="divide-y">
      {items.map((item) => {
        const tag = FOCUS_LABEL[item.kind];
        return (
          <li key={item.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <Badge variant={tag.variant} className="mt-0.5 shrink-0">
              {tag.label}
            </Badge>
            <div className="min-w-0 flex-1">
              <Link href={item.href} className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline">
                {item.title}
              </Link>
              <p className="text-xs text-ink-3">{item.subtitle}</p>
            </div>
            <Link href={item.href} className="shrink-0 rounded-full p-1.5 text-ink-4 hover:bg-inset hover:text-primary" aria-label={`Open ${item.title}`}>
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function MomentumList({ m }: { m: Momentum }) {
  const rows: [string, number, number][] = [
    ["Funders moved forward", m.advances30, m.advancesPrev30],
    ["Contacts logged", m.touches30, m.touchesPrev30],
    ["Funders added", m.added30, m.addedPrev30],
  ];
  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([label, now, prev]) => {
        const d = now - prev;
        return (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-sm text-ink-2">{label}</dt>
            <dd className="flex items-baseline gap-2">
              <span className="tnum font-mono text-base font-semibold text-foreground">{formatNumber(now)}</span>
              <span className={cn("tnum text-xs", d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-ink-3")}>
                {d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "same"}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function CreditsUsed({ usage }: { usage: UsageSummary }) {
  const limit = usage.monthlyLimit;
  const pct = limit ? Math.min(100, Math.round((usage.used / limit) * 100)) : 0;
  const nearLimit = limit !== null && pct >= 90;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="tnum font-mono text-base font-semibold text-foreground">
          {formatNumber(usage.used)}
          {limit !== null ? <span className="text-sm font-normal text-ink-3"> of {formatNumber(limit)}</span> : null}
        </span>
        <Badge variant="secondary">{usage.planName}</Badge>
      </div>
      {limit !== null ? (
        <Progress value={pct} aria-label={`${pct}% of AI credits used`} className="h-1.5" indicatorClassName={nearLimit ? "bg-warning" : undefined} />
      ) : (
        <p className="text-xs text-ink-3">No limit on this plan. Use is still recorded.</p>
      )}
      <p className="text-xs text-ink-3">
        {limit !== null && usage.used >= limit ? "Limit reached. " : ""}
        Resets {formatDate(usage.periodEnd)}.
      </p>
      <p className="text-xs text-ink-3">
        A search filter costs {usage.creditCosts.filter}, a fit analysis {usage.creditCosts.fit}, a research dossier {usage.creditCosts.research}.
      </p>
      <Link href="/app/settings/billing" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <Coins className="size-3.5" aria-hidden />
        Plan and billing
      </Link>
    </div>
  );
}

function GettingStarted() {
  const steps: { title: string; body: string; href: string; label: string; icon: typeof Search }[] = [
    {
      title: "Find funders",
      body: "Search by name, EIN, or describe the work you do. Save the ones worth a look.",
      href: "/app/search",
      label: "Search funders",
      icon: Search,
    },
    {
      title: "Bring a list you already keep",
      body: "Upload a CSV. Each row is matched by EIN, then by exact name, and you see every match before anything is saved.",
      href: "/app/import",
      label: "Import a spreadsheet",
      icon: Upload,
    },
    {
      title: "Tell the AI about your work",
      body: "Add facts about your organization. Approved facts make fit analyses and drafts specific to you.",
      href: "/app/knowledge",
      label: "Add knowledge",
      icon: Bookmark,
    },
  ];
  return (
    <section className="mb-6 rounded-lg border border-primary-border bg-primary-tint/50 p-4 sm:p-5" aria-label="Getting started">
      <h2 className="text-base font-semibold text-foreground">Start here</h2>
      <p className="mt-1 text-sm text-ink-3">Your list is empty. Three ways to fill it.</p>
      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.href} className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="tnum grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
              <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
            </div>
            <p className="flex-1 text-xs leading-5 text-ink-3">{s.body}</p>
            <Button asChild size="sm" variant="outline" className="self-start">
              <Link href={s.href}>
                <s.icon aria-hidden />
                {s.label}
              </Link>
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="flex flex-col gap-6 xl:col-span-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

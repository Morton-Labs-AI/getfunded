import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { History, ListChecks, MessageSquare, Users } from "lucide-react";

import { FitPanel } from "@/components/ai/fit-panel";
import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { YoursBlock, YoursTag } from "@/components/data/yours-tag";
import { FunderProfile } from "@/components/funder/funder-profile";
import { ProfileSkeleton } from "@/components/funder/profile-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActivityForm } from "@/components/workspace/activity-form";
import { ActivityTimeline } from "@/components/workspace/activity-timeline";
import { ContactList } from "@/components/workspace/contact-list";
import { PageBody, SectionTitle } from "@/components/workspace/page-header";
import { SaveFunderButton } from "@/components/workspace/save-funder-button";
import { YoursSkeleton } from "@/components/workspace/skeletons";
import { StageHistoryList } from "@/components/workspace/stage-history-list";
import { StageSelect } from "@/components/workspace/stage-select";
import { TaskDialog } from "@/components/workspace/task-dialog";
import { TaskList } from "@/components/workspace/task-list";
import { formatDate } from "@/lib/format";
import { getFunder } from "@/lib/queries/corpus/funder";
import { isUuid } from "@/lib/queries/corpus/safe";
import type { FunderRecord } from "@/lib/queries/corpus/types";
import { listActivities, listStageHistory } from "@/lib/workspace/activities";
import { listContacts } from "@/lib/workspace/contacts";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { firstParam, type RawParams } from "@/lib/workspace/filters";
import { listMembers } from "@/lib/workspace/members";
import { softFail } from "@/lib/workspace/safe";
import { getSavedByOrg } from "@/lib/workspace/saved";
import { TIER_LABELS } from "@/lib/workspace/stages";
import { listTasksForFunder } from "@/lib/workspace/tasks";
import type { FunderSnapshot, SavedFunder, WorkspaceCtx } from "@/lib/workspace/types";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<RawParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const funder = isUuid(id) ? await getFunder(id) : null;
  return { title: funder?.name ?? "Funder", robots: { index: false, follow: false } };
}

/**
 * A funder inside the workspace: the public profile (Source data from
 * filings) with the Save button and the AI fit panel in its slots, then the
 * YOURS half: stage, owner, notes, tasks, contacts and stage history. The
 * Yours half only exists once the funder is saved.
 */
export default function AppFunderPage({ params, searchParams }: Props) {
  return (
    <PageBody>
      <Suspense
        fallback={
          <div className="flex flex-col gap-8">
            <ProfileSkeleton />
            <YoursSkeleton />
          </div>
        }
      >
        <FunderContent params={params} searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

function snapshotOf(f: FunderRecord): FunderSnapshot {
  return { orgId: f.orgId, name: f.name, ein: f.ein, orgType: f.orgType, city: f.city, state: f.state, website: f.website };
}

async function FunderContent({ params, searchParams }: Props) {
  const [{ id }, sp, { user, workspace }] = await Promise.all([params, searchParams, requireWorkspace()]);
  if (!isUuid(id)) notFound();
  const funder = await getFunder(id);
  if (!funder) notFound();
  // A merged record's page sends the reader to the canonical row.
  if (funder.canonicalOrgId && funder.canonicalOrgId !== funder.orgId) redirect(`/app/funders/${funder.canonicalOrgId}`);

  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };
  const saved = await softFail("saved funder", null, () => getSavedByOrg(ctx, funder.orgId));
  const snapshot = snapshotOf(funder);
  const page = Number(firstParam(sp.gpage)) || 1;
  const q = firstParam(sp.gq) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <FunderProfile
        orgId={funder.orgId}
        mode="app"
        grants={{ page, q }}
        slots={{
          afterHeader: (
            <SaveFunderButton
              orgId={funder.orgId}
              snapshot={snapshot}
              saved={saved !== null}
              savedFunderId={saved?.id}
              sourceDetail="Saved from the funder page"
              size="default"
            />
          ),
          sidebar: <FitPanel orgId={funder.orgId} savedFunderId={saved?.id} />,
        }}
      />

      {saved ? (
        <Suspense fallback={<YoursSkeleton />}>
          <YoursSections ctx={ctx} saved={saved} currentUserId={user.id} />
        </Suspense>
      ) : (
        <YoursBlock title={WORKSPACE_COPY.yours.label}>
          <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">This funder is not on your list yet.</p>
              <p className="mt-0.5 text-sm text-ink-3">Save it to set a stage and owner, log notes and calls, add tasks and contacts, and keep its history.</p>
            </div>
            <SaveFunderButton orgId={funder.orgId} snapshot={snapshot} sourceDetail="Saved from the funder page" size="default" />
          </div>
        </YoursBlock>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- yours */

async function YoursSections({ ctx, saved, currentUserId }: { ctx: WorkspaceCtx; saved: SavedFunder; currentUserId: string }) {
  const [activities, tasks, contacts, history, members] = await Promise.all([
    softFail("timeline", [], () => listActivities(ctx, saved.id)),
    softFail("funder tasks", [], () => listTasksForFunder(ctx, saved.id)),
    softFail("contacts", [], () => listContacts(ctx, saved.id)),
    softFail("stage history", [], () => listStageHistory(ctx, saved.id)),
    softFail("members", [], () => listMembers(ctx)),
  ]);
  const name = saved.snapshot.name;
  const editHref = `/app/saved?q=${encodeURIComponent(name)}`;
  const openTasks = tasks.filter((t) => t.status === "open");

  return (
    <section id="yours" className="flex flex-col gap-6" aria-labelledby="yours-title">
      <SectionTitle
        hint={WORKSPACE_COPY.yours.explainer}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={editHref}>Edit in Saved funders</Link>
          </Button>
        }
      >
        <span id="yours-title" className="inline-flex items-center gap-2">
          Your relationship
          <YoursTag />
        </span>
      </SectionTitle>

      <YoursBlock title="Where it stands">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-ink-3">Stage</dt>
            <dd>
              <StageSelect id={saved.id} stage={saved.stage} version={saved.version} name={name} />
            </dd>
          </div>
          <Fact label="Tier">{saved.tier ? TIER_LABELS[saved.tier] : <span className="text-ink-3">Not set</span>}</Fact>
          <Fact label="Owner">{saved.ownerName ?? <span className="text-ink-3">Nobody yet</span>}</Fact>
          <Fact label="Planned ask">{saved.askAmount !== null ? <Money value={saved.askAmount} mono={false} /> : <span className="text-ink-3">Not set</span>}</Fact>
          <Fact label="Next action">
            {saved.nextAction ?? <span className="text-ink-3">Not set</span>}
            {saved.nextActionDue ? <span className="tnum text-ink-3"> · due {formatDate(saved.nextActionDue)}</span> : null}
          </Fact>
          <Fact label="Last contact">{saved.lastTouchAt ? <span className="tnum">{formatDate(saved.lastTouchAt)}</span> : <span className="text-ink-3">{WORKSPACE_COPY.neverContacted}</span>}</Fact>
          <Fact label="Saved on">
            <span className="tnum">{formatDate(saved.createdAt)}</span>
          </Fact>
          <Fact label={WORKSPACE_COPY.saved.whyOnList}>{saved.sourceDetail ?? <span className="text-ink-3">{WORKSPACE_COPY.saved.whyOnListMissing}</span>}</Fact>
        </dl>
        {saved.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {saved.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
        ) : null}
      </YoursBlock>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card icon={MessageSquare} title="Notes and contact log" hint="Calls, emails, meetings and notes, newest first. The app adds its own records for saves, stage moves and imports.">
          <ActivityForm savedFunderId={saved.id} />
          <div className="mt-5 border-t pt-4">
            {activities.length === 0 ? <p className="text-sm text-ink-3">Nothing logged yet. The first note starts the timeline.</p> : <ActivityTimeline activities={activities} />}
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card
            icon={ListChecks}
            title="Tasks"
            hint={openTasks.length > 0 ? `${openTasks.length} open` : "Nothing open."}
            action={<TaskDialog members={members} currentUserId={currentUserId} savedFunderId={saved.id} funderName={name} />}
          >
            {tasks.length === 0 ? <p className="text-sm text-ink-3">No tasks for this funder yet.</p> : <TaskList tasks={tasks} compact />}
          </Card>

          <Card icon={Users} title="Your contacts" hint="People your team added. Public filing contacts stay in the profile above with their own Source chip.">
            <ContactList savedFunderId={saved.id} contacts={contacts} />
          </Card>

          <Card icon={History} title="Stage history" hint="Every move, newest first.">
            <StageHistoryList history={history} />
          </Card>
        </div>
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-foreground">{children ?? <Missing bare />}</dd>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  hint,
  action,
  children,
}: {
  icon: typeof Users;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-yours-tint text-yours">
            <Icon className="size-3.5" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {hint ? <p className="text-xs leading-5 text-ink-3">{hint}</p> : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

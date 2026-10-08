import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { YoursTag } from "@/components/data/yours-tag";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FunnelBars } from "@/components/workspace/funnel-bars";
import { EmptyState, PageBody, PageHeader, SectionTitle } from "@/components/workspace/page-header";
import { PrintButton } from "@/components/workspace/print-button";
import { UpgradeNotice } from "@/components/workspace/upgrade-notice";
import { formatDate, formatNumber } from "@/lib/format";
import { can } from "@/lib/plans";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { pipelineFunnel } from "@/lib/workspace/dashboard";
import { activityCounts, pipelineByStage, stageVelocity, topAsks } from "@/lib/workspace/reports";
import { softFail } from "@/lib/workspace/safe";
import { getWorkspacePlan } from "@/lib/workspace/saved";
import { BOARD_STAGES, STAGE_LABELS } from "@/lib/workspace/stages";
import type { ActivityKind, WorkspaceCtx } from "@/lib/workspace/types";

export const metadata: Metadata = { title: WORKSPACE_COPY.reports.title };

const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  note: "Notes",
  email: "Emails",
  call: "Calls",
  meeting: "Meetings",
  letter: "Letters",
  event: "Events",
  system: "App records (saves, moves, imports)",
};

/**
 * The printable report: funnel, planned asks by stage, the biggest asks,
 * activity counts and stage timing. Reports are part of Pro and above
 * (docs/PLANS.md); other plans see what the report holds and a link to plans.
 * Every number is the workspace's own data, so the page carries the Yours tag.
 */
export default function ReportsPage() {
  return (
    <PageBody className="print-report">
      <Suspense fallback={<ReportsSkeleton />}>
        <ReportsContent />
      </Suspense>
    </PageBody>
  );
}

async function ReportsContent() {
  const { user, workspace } = await requireWorkspace();
  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };
  const plan = await softFail("plan", null, () => getWorkspacePlan(ctx));
  const allowed = plan !== null && can(plan, "reports");

  if (!allowed) {
    return (
      <>
        <PageHeader eyebrow={WORKSPACE_COPY.yours.label} title={WORKSPACE_COPY.reports.title} subtitle={WORKSPACE_COPY.reports.subtitle} />
        <div className="flex max-w-2xl flex-col gap-4">
          <UpgradeNotice message={WORKSPACE_COPY.limits.reports} linkLabel={WORKSPACE_COPY.limits.upgrade} href={WORKSPACE_COPY.limits.upgradeHref} />
          <section className="rounded-lg border bg-card p-4 shadow-card sm:p-5">
            <h2 className="text-sm font-semibold text-foreground">What the report holds</h2>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-2">
              <li>The pipeline funnel: how many funders reached each stage.</li>
              <li>Planned asks by stage, and the fifteen biggest asks with their owners.</li>
              <li>How much work the team logged in the last 30 and 90 days.</li>
              <li>How long funders spend in each stage before they move.</li>
              <li>A print layout for a board packet or a PDF.</li>
            </ul>
            <p className="mt-3 text-sm text-ink-3">
              The funnel and today&apos;s totals are always on your{" "}
              <Link href="/app" className="font-medium text-primary hover:underline">
                dashboard
              </Link>
              .
            </p>
          </section>
        </div>
      </>
    );
  }

  const [funnel, byStage, counts, asks, velocity] = await Promise.all([
    softFail("funnel", [], () => pipelineFunnel(ctx)),
    softFail("by stage", [], () => pipelineByStage(ctx)),
    softFail("activity counts", [], () => activityCounts(ctx)),
    softFail("top asks", [], () => topAsks(ctx, 15)),
    softFail("velocity", [], () => stageVelocity(ctx)),
  ]);
  const preparedOn = formatDate(new Date(), "long");

  const boardRows = BOARD_STAGES.map((stage) => byStage.find((r) => r.stage === stage)).filter((r) => r !== undefined);
  const exitRows = byStage.filter((r) => !(BOARD_STAGES as readonly string[]).includes(r.stage) && r.funders > 0);
  const pipelineTotal = boardRows.reduce<number | null>((sum, r) => (r.askTotal === null ? sum : (sum ?? 0) + r.askTotal), null);
  const anyActivity = counts.some((c) => c.allTime > 0);

  return (
    <>
      <PageHeader
        eyebrow={WORKSPACE_COPY.yours.label}
        title={WORKSPACE_COPY.reports.title}
        subtitle={WORKSPACE_COPY.reports.subtitle}
        actions={<PrintButton />}
        className="print:mb-4"
      />

      <p className="tnum mb-6 hidden text-sm text-ink-3 print:block">
        {workspace.name} · prepared {preparedOn} · {WORKSPACE_COPY.reports.askDisclaimer}
      </p>

      <div className="grid gap-6 print:grid-cols-1 xl:grid-cols-2">
        <Report title="Pipeline funnel" hint="How many funders reached each stage or went further, and how many sit there today.">
          {funnel.every((r) => r.reached === 0) ? (
            <EmptyState title="No stage history yet" hint="As you move funders through the pipeline, their path shows up here." />
          ) : (
            <FunnelBars rows={funnel} />
          )}
        </Report>

        <Report title="Planned asks by stage" hint={WORKSPACE_COPY.reports.askDisclaimer}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Funders</TableHead>
                <TableHead className="text-right">With an ask</TableHead>
                <TableHead className="text-right">Planned ask</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {boardRows.map((r) => (
                <TableRow key={r.stage}>
                  <TableCell className="text-ink-2">{STAGE_LABELS[r.stage]}</TableCell>
                  <TableCell className="tnum text-right">{formatNumber(r.funders)}</TableCell>
                  <TableCell className="tnum text-right text-ink-3">{formatNumber(r.askCount)}</TableCell>
                  <TableCell className="text-right font-medium">
                    <Money value={r.askTotal} />
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-inset/40 font-medium">
                <TableCell>In the pipeline</TableCell>
                <TableCell className="tnum text-right">{formatNumber(boardRows.reduce((s, r) => s + r.funders, 0))}</TableCell>
                <TableCell className="tnum text-right text-ink-3">{formatNumber(boardRows.reduce((s, r) => s + r.askCount, 0))}</TableCell>
                <TableCell className="text-right">
                  <Money value={pipelineTotal} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          {exitRows.length > 0 ? (
            <p className="tnum mt-3 text-xs text-ink-3">
              Not counted above: {exitRows.map((r) => `${formatNumber(r.funders)} ${STAGE_LABELS[r.stage].toLowerCase()}`).join(", ")}.
            </p>
          ) : null}
        </Report>

        <Report title="Biggest planned asks" hint="The fifteen largest working figures on your list, with who owns each relationship.">
          {asks.length === 0 ? (
            <EmptyState
              title="No planned asks yet"
              hint="Set a planned ask on a funder in Saved funders and it appears here."
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/app/saved">Open Saved funders</Link>
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funder</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Planned ask</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {asks.map((a) => (
                  <TableRow key={a.savedFunderId}>
                    <TableCell className="max-w-[16rem] truncate">
                      <Link href={`/app/funders/${a.orgId}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {a.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink-2">{STAGE_LABELS[a.stage]}</TableCell>
                    <TableCell className="text-ink-2">{a.ownerName ?? <span className="text-ink-3">Nobody yet</span>}</TableCell>
                    <TableCell className="text-right font-medium">
                      <Money value={a.askAmount} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Report>

        <Report title="Work logged" hint="What the team recorded on funder timelines.">
          {!anyActivity ? (
            <EmptyState title="Nothing logged yet" hint="Log a note, call or meeting on a funder's page and the counts start here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Last 30 days</TableHead>
                  <TableHead className="text-right">Last 90 days</TableHead>
                  <TableHead className="text-right">All time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.map((c) => (
                  <TableRow key={c.kind} className={c.kind === "system" ? "text-ink-3" : undefined}>
                    <TableCell className="whitespace-normal">{ACTIVITY_LABELS[c.kind]}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(c.last30)}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(c.last90)}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(c.allTime)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Report>

        <Report title="How long each step takes" hint="Median days a funder spent in the previous stage before each kind of move.">
          {velocity.length === 0 ? (
            <EmptyState title="No stage moves recorded yet" hint="Move a funder on the pipeline board and timing shows up here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Move</TableHead>
                  <TableHead className="text-right">Times</TableHead>
                  <TableHead className="text-right">Median days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {velocity.map((v) => (
                  <TableRow key={`${v.fromStage}-${v.toStage}`}>
                    <TableCell className="whitespace-normal text-ink-2">
                      {STAGE_LABELS[v.fromStage]} <span className="text-ink-4">→</span> {STAGE_LABELS[v.toStage]}
                    </TableCell>
                    <TableCell className="tnum text-right">{formatNumber(v.moves)}</TableCell>
                    <TableCell className="tnum text-right font-medium">{v.medianDays === null ? <Missing bare /> : formatNumber(v.medianDays)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Report>
      </div>
    </>
  );
}

function Report({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-card print:break-inside-avoid print:shadow-none sm:p-5">
      <SectionTitle hint={hint} action={<YoursTag />}>
        {title}
      </SectionTitle>
      {children}
    </section>
  );
}

function ReportsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading reports">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-2 h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    </div>
  );
}

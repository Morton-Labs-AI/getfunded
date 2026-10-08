import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileSpreadsheet } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { ImportWizard } from "@/components/workspace/import-wizard";
import { PageBody, PageHeader, SectionTitle } from "@/components/workspace/page-header";
import { UpgradeNotice } from "@/components/workspace/upgrade-notice";
import { formatDate, formatNumber } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { listImports } from "@/lib/workspace/imports";
import { softFail } from "@/lib/workspace/safe";
import { countSaved, getWorkspacePlan } from "@/lib/workspace/saved";
import { run } from "@/lib/workspace/sql";
import type { WorkspaceCtx } from "@/lib/workspace/types";

export const metadata: Metadata = { title: WORKSPACE_COPY.import.title };

/**
 * CSV import. The wizard parses in the browser and writes nothing until the
 * person presses Start; the server matches by EIN, then exact name, and
 * sends them to the report at /app/import/[id]. Past imports are listed so
 * every report stays reachable.
 */
export default function ImportPage() {
  return (
    <PageBody>
      <Suspense fallback={<ImportSkeleton />}>
        <ImportContent />
      </Suspense>
    </PageBody>
  );
}

async function ImportContent() {
  const { user, workspace } = await requireWorkspace();
  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };
  const [history, plan, saved] = await Promise.all([
    softFail("imports", [], () => listImports(ctx)),
    softFail("plan", null, () => getWorkspacePlan(ctx)),
    softFail("saved count", null, () => run(ctx, undefined, (sql) => countSaved(sql, ctx.workspaceId))),
  ]);
  const limit = plan?.saved_funders_limit ?? null;
  const room = limit === null || saved === null ? null : Math.max(0, limit - saved);

  return (
    <>
      <PageHeader eyebrow={WORKSPACE_COPY.yours.label} title={WORKSPACE_COPY.import.title} subtitle={WORKSPACE_COPY.import.subtitle} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          {limit !== null && room === 0 ? (
            <UpgradeNotice
              message={`Your list is full: your plan holds ${formatNumber(limit)} saved funders and you have ${formatNumber(saved ?? limit)}. Rows that match will be listed in the report, not added.`}
            />
          ) : limit !== null ? (
            <p className="text-sm leading-6 text-ink-3" role="note">
              Your plan holds {formatNumber(limit)} saved funders.
              {room !== null ? ` You have ${formatNumber(saved ?? 0)}, so this import can add up to ${formatNumber(room)} more.` : ""} Rows past
              that are listed in the report, not added.
            </p>
          ) : null}
          <ImportWizard />
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <SectionTitle hint="Every import keeps its full report.">Past imports</SectionTitle>
          {history.length === 0 ? (
            <p className="text-sm text-ink-3">No imports yet. The first one shows up here with its report.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card shadow-card">
              {history.map((i) => (
                <li key={i.id} className="px-3 py-2.5">
                  <Link href={`/app/import/${i.id}`} className="flex items-start gap-2 text-sm font-medium text-foreground hover:text-primary hover:underline">
                    <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0 truncate">{i.filename}</span>
                  </Link>
                  <p className="tnum mt-0.5 pl-6 text-xs text-ink-3">
                    {formatNumber(i.rowCount)} rows · {formatNumber(i.matched)} added · {formatDate(i.createdAt)}
                    {i.createdByName ? ` · ${i.createdByName}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}

function ImportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading import">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-2 h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

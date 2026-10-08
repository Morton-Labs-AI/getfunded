import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportReportTable } from "@/components/workspace/import-report";
import { EmptyState, PageBody, PageHeader } from "@/components/workspace/page-header";
import { formatDate, formatNumber } from "@/lib/format";
import { isUuid } from "@/lib/queries/corpus/safe";
import { requireWorkspace } from "@/lib/workspace/context";
import { MATCH_STATUS_LABELS, type MatchStatus } from "@/lib/workspace/import-match";
import { getImport } from "@/lib/workspace/imports";
import { softFail } from "@/lib/workspace/safe";

export const metadata: Metadata = { title: "Import report" };

type Props = { params: Promise<{ id: string }> };

const STATUS_ORDER: MatchStatus[] = ["matched_ein", "matched_name", "already_saved", "ambiguous", "unmatched", "limit_reached", "empty"];

const TONE: Record<MatchStatus, "success" | "secondary" | "warning" | "outline" | "danger"> = {
  matched_ein: "success",
  matched_name: "success",
  already_saved: "secondary",
  ambiguous: "warning",
  unmatched: "outline",
  empty: "outline",
  limit_reached: "danger",
};

/** One import, every row: what happened and why. Nothing was merged on a guess. */
export default function ImportReportPage({ params }: Props) {
  return (
    <PageBody>
      <Suspense fallback={<ReportSkeleton />}>
        <ReportContent params={params} />
      </Suspense>
    </PageBody>
  );
}

async function ReportContent({ params }: Props) {
  const [{ id }, { user, workspace }] = await Promise.all([params, requireWorkspace()]);
  if (!isUuid(id)) notFound();
  const result = await softFail("import report", null, () => getImport({ userId: user.id, workspaceId: workspace.id }, id));
  if (!result) notFound();
  const { summary, report } = result;

  return (
    <>
      <PageHeader
        eyebrow="Import report"
        title={summary.filename}
        subtitle={
          <span className="tnum">
            {formatNumber(summary.rowCount)} rows · {formatNumber(summary.matched)} added to your list · {formatNumber(summary.unmatched)} not added ·{" "}
            {formatDate(summary.createdAt, "long")}
            {summary.createdByName ? ` · ${summary.createdByName}` : ""}
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/app/import">Import another file</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/app/saved">Open Saved funders</Link>
            </Button>
          </>
        }
      />

      {report ? (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-wrap gap-2" aria-label="Results by outcome">
            {STATUS_ORDER.filter((s) => report.counts[s] > 0).map((s) => (
              <li key={s}>
                <Badge variant={TONE[s]} className="tnum">
                  {formatNumber(report.counts[s])} · {MATCH_STATUS_LABELS[s]}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-3">
            Rows marked &ldquo;Needs a decision&rdquo; or &ldquo;Not found&rdquo; were not added. Open a listed organization to save it by hand, or add an EIN to the row and import again.
            Re-importing the same file is safe: funders already on your list are reported and left unchanged.
          </p>
          <ImportReportTable report={report} />
        </div>
      ) : (
        <EmptyState
          title="This import has no row-by-row detail"
          hint="It was recorded before reports kept every row. The counts above are correct."
        />
      )}
    </>
  );
}

function ReportSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading import report">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-8 w-72 max-w-full" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-6 w-32" />
        ))}
      </div>
      <Skeleton className="mt-4 h-96 w-full" />
    </div>
  );
}

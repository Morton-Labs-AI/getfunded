import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, PageBody, PageHeader } from "@/components/workspace/page-header";
import { SavedFiltersBar } from "@/components/workspace/saved-filters";
import { SavedTable } from "@/components/workspace/saved-table";
import { SavedSkeleton } from "@/components/workspace/skeletons";
import { UpgradeNotice } from "@/components/workspace/upgrade-notice";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { exportLimitFor } from "@/lib/workspace/export";
import { hasFilters, parseSavedFilters, type RawParams } from "@/lib/workspace/filters";
import { listMembers } from "@/lib/workspace/members";
import { softFail } from "@/lib/workspace/safe";
import { getWorkspacePlan, listCollections, listSaved } from "@/lib/workspace/saved";
import type { WorkspaceCtx } from "@/lib/workspace/types";

export const metadata: Metadata = { title: WORKSPACE_COPY.saved.title };

type Props = { searchParams: Promise<RawParams> };

/**
 * The working list. Filters live in the URL; every cell edit is a
 * compare-and-swap through a server action; CSV export honours the plan's
 * row cap (Free: 100 rows) inside `exportSavedCsvAction`.
 */
export default function SavedPage({ searchParams }: Props) {
  return (
    <PageBody>
      <Suspense fallback={<SavedSkeleton />}>
        <SavedContent searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

async function SavedContent({ searchParams }: Props) {
  const [sp, { user, workspace }] = await Promise.all([searchParams, requireWorkspace()]);
  const filters = parseSavedFilters(sp);
  const filtered = hasFilters(filters);
  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };

  const [rows, members, collections, plan] = await Promise.all([
    softFail("saved list", null, () => listSaved(ctx, filters)),
    softFail("members", [], () => listMembers(ctx)),
    softFail("collections", [], () => listCollections(ctx)),
    softFail("plan", null, () => getWorkspacePlan(ctx)),
  ]);

  const exportLimit = plan ? exportLimitFor(plan) : null;
  const savedLimit = plan?.saved_funders_limit ?? null;
  const atSavedLimit = rows !== null && !filtered && savedLimit !== null && rows.length >= savedLimit;
  const exportCapped = rows !== null && exportLimit !== null && exportLimit > 0 && rows.length > exportLimit;

  return (
    <>
      <PageHeader
        eyebrow={WORKSPACE_COPY.yours.label}
        title={WORKSPACE_COPY.saved.title}
        subtitle={WORKSPACE_COPY.saved.subtitle}
        actions={
          <Button asChild size="sm">
            <Link href="/app/search">
              <Search aria-hidden />
              Find funders
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <SavedFiltersBar
          base="/app/saved"
          current={filters}
          members={members}
          collections={collections}
          showSort
          showExport={exportLimit !== 0}
          exportLimit={exportLimit}
        />

        {atSavedLimit && savedLimit !== null ? <UpgradeNotice message={WORKSPACE_COPY.limits.savedFunders(savedLimit)} /> : null}
        {exportCapped && exportLimit !== null && rows ? (
          <UpgradeNotice message={WORKSPACE_COPY.saved.exportTruncated(exportLimit, rows.length)} linkLabel="Export every row" />
        ) : null}

        {rows === null ? (
          <EmptyState
            tone="problem"
            title="We could not load your funders right now"
            hint="The connection to the database dropped. Wait a moment and reload the page. Nothing has been lost."
          />
        ) : rows.length === 0 && filtered ? (
          <EmptyState
            title={WORKSPACE_COPY.saved.noMatch}
            hint="Clear the search or a filter to see the rest of your list."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/app/saved">Clear filters</Link>
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={WORKSPACE_COPY.saved.empty}
            hint={WORKSPACE_COPY.saved.emptyHint}
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
          <>
            <p className="tnum text-xs text-ink-3" aria-live="polite">
              {rows.length} {rows.length === 1 ? "funder" : "funders"}
              {filtered ? " match these filters" : " on your list"}
              {savedLimit !== null && !filtered ? ` · your plan holds ${savedLimit}` : ""}
            </p>
            <SavedTable rows={rows} members={members} collections={collections} currentUserId={user.id} />
          </>
        )}
      </div>
    </>
  );
}

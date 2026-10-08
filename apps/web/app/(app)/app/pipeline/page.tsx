import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, PageBody, PageHeader } from "@/components/workspace/page-header";
import { PipelineBoard } from "@/components/workspace/pipeline-board";
import { SavedFiltersBar } from "@/components/workspace/saved-filters";
import { PipelineSkeleton } from "@/components/workspace/skeletons";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { hasFilters, parseSavedFilters, type RawParams } from "@/lib/workspace/filters";
import { listMembers } from "@/lib/workspace/members";
import { softFail } from "@/lib/workspace/safe";
import { listCollections, listSaved } from "@/lib/workspace/saved";
import type { WorkspaceCtx } from "@/lib/workspace/types";

export const metadata: Metadata = { title: WORKSPACE_COPY.pipeline.title };

type Props = { searchParams: Promise<RawParams> };

/**
 * The board. Same rows and URL filters as the saved list, laid out by stage.
 * A drop calls `getfunded.move_stage()` with the card's version; the move is
 * written to the funder's history and timeline in the same transaction.
 */
export default function PipelinePage({ searchParams }: Props) {
  return (
    <PageBody>
      <Suspense fallback={<PipelineSkeleton />}>
        <PipelineContent searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

async function PipelineContent({ searchParams }: Props) {
  const [sp, { user, workspace }] = await Promise.all([searchParams, requireWorkspace()]);
  const filters = parseSavedFilters(sp);
  const filtered = hasFilters(filters);
  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };

  const [rows, members, collections] = await Promise.all([
    softFail("pipeline rows", null, () => listSaved(ctx, { ...filters, sort: "updated" })),
    softFail("members", [], () => listMembers(ctx)),
    softFail("collections", [], () => listCollections(ctx)),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={WORKSPACE_COPY.yours.label}
        title={WORKSPACE_COPY.pipeline.title}
        subtitle={WORKSPACE_COPY.pipeline.subtitle}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/app/saved">Open as a list</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <SavedFiltersBar base="/app/pipeline" current={filters} members={members} collections={collections} showSort={false} />

        {rows === null ? (
          <EmptyState
            tone="problem"
            title="We could not load the board right now"
            hint="The connection to the database dropped. Wait a moment and reload the page. Nothing has been lost."
          />
        ) : rows.length === 0 && filtered ? (
          <EmptyState
            title="No cards match those filters"
            hint="Clear the search or a filter to see the whole board."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/app/pipeline">Clear filters</Link>
              </Button>
            }
          />
        ) : rows.length === 0 ? (
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
          <>
            <p className="tnum text-xs text-ink-3" aria-live="polite">
              {rows.length} {rows.length === 1 ? "funder" : "funders"} on the board
              {filtered ? " after filters" : ""}. Each card also has a stage menu for keyboard and screen-reader use.
            </p>
            <PipelineBoard initial={rows} />
          </>
        )}
      </div>
    </>
  );
}

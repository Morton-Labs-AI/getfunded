import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BadgeCheck } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { KnowledgeDialog, KnowledgeList } from "@/components/workspace/knowledge-list";
import { EmptyState, PageBody, PageHeader } from "@/components/workspace/page-header";
import { formatNumber } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace/context";
import { WORKSPACE_COPY } from "@/lib/workspace/copy";
import { listKnowledge } from "@/lib/workspace/knowledge";
import { softFail } from "@/lib/workspace/safe";

export const metadata: Metadata = { title: WORKSPACE_COPY.knowledge.title };

/**
 * Facts, programs, outcomes and boilerplate about the applicant. Anyone can
 * add a draft; only an owner or admin approves; only approved items ever
 * reach a prompt. The page says so in plain words.
 */
export default function KnowledgePage() {
  return (
    <PageBody>
      <Suspense fallback={<KnowledgeSkeleton />}>
        <KnowledgeContent />
      </Suspense>
    </PageBody>
  );
}

async function KnowledgeContent() {
  const { user, workspace } = await requireWorkspace();
  const items = await softFail("knowledge", null, () => listKnowledge({ userId: user.id, workspaceId: workspace.id }));
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const approved = items?.filter((i) => i.approved).length ?? 0;

  return (
    <>
      <PageHeader eyebrow={WORKSPACE_COPY.yours.label} title={WORKSPACE_COPY.knowledge.title} subtitle={WORKSPACE_COPY.knowledge.subtitle} actions={<KnowledgeDialog />} />

      <div className="flex max-w-4xl flex-col gap-4">
        <div role="status" className="flex flex-col gap-1 rounded-md border bg-inset px-3 py-2.5 text-sm text-ink-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <BadgeCheck className="size-4 shrink-0 text-success" aria-hidden />
            <span className="tnum">
              {items ? `${formatNumber(approved)} of ${formatNumber(items.length)} items approved.` : ""} {WORKSPACE_COPY.knowledge.approvedOnly}
            </span>
          </span>
          <span className="text-xs text-ink-3">
            {isAdmin ? "You can approve items." : "Only a workspace owner or admin can approve items."}{" "}
            Your mission and program areas live in{" "}
            <Link href="/app/settings/organization" className="font-medium text-primary hover:underline">
              Settings
            </Link>
            .
          </span>
        </div>

        {items === null ? (
          <EmptyState
            tone="problem"
            title="We could not load your knowledge right now"
            hint="The connection to the database dropped. Wait a moment and reload the page. Nothing has been lost."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            hint="Add a fact about your organization, a program, a result you can stand behind, or wording you reuse. It starts as a draft; an admin approves it before the AI may use it."
            action={<KnowledgeDialog />}
          />
        ) : (
          <KnowledgeList items={items} isAdmin={isAdmin} />
        )}
      </div>
    </>
  );
}

function KnowledgeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading knowledge">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-2 h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <Skeleton className="mt-6 h-10 w-full max-w-4xl" />
      <div className="mt-4 max-w-4xl rounded-lg border bg-card">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="m-4 h-16" />
        ))}
      </div>
    </div>
  );
}

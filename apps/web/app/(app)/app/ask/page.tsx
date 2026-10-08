import type { Metadata } from "next";
import { Suspense } from "react";

import { AskAiBadge, AskChat } from "@/components/ai/ask-chat";
import { UpgradeNotice } from "@/components/settings/upgrade-notice";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageBody, PageHeader } from "@/components/workspace/page-header";
import { AI_COPY } from "@/lib/ai/copy";
import { aiMode } from "@/lib/billing/meter";
import { analystEnabled } from "@/lib/db/corpus";
import { CREDIT_COSTS, can, isSelfHosted, planFor } from "@/lib/plans";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = {
  title: AI_COPY.ask.title,
  robots: { index: false, follow: false },
};

const WHAT_ASK_ANSWERS =
  "Ask can answer questions about the public funder data: which funders give where and how much, who accepts applications, " +
  "and what a funder's grant history looks like. It writes one read-only query, runs it, and explains the result in plain words; " +
  "it cannot see your saved funders or notes, and it never changes anything.";

/**
 * /app/ask: the analyst. The header prerenders; the chat waits for the
 * session (requireWorkspace) behind Suspense. When ANALYST_DATABASE_URL is
 * unset the page says so instead of falling back to the app's own pool.
 */
export default function AskPage() {
  return (
    <PageBody className="max-w-4xl">
      <PageHeader eyebrow="AI" title={AI_COPY.ask.title} subtitle={WHAT_ASK_ANSWERS} actions={<AskAiBadge />} />
      <Suspense fallback={<AskSkeleton />}>
        <AskContent />
      </Suspense>
    </PageBody>
  );
}

function AskSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}

async function AskContent() {
  const { workspace } = await requireWorkspace();
  const plan = planFor(workspace);

  if (!can(plan, "ask")) {
    return <UpgradeNotice feature="ask" selfHosted={isSelfHosted()} />;
  }
  if (!analystEnabled) {
    return <EmptyState title={AI_COPY.ask.notConfigured} hint={AI_COPY.ask.notConfiguredHint} />;
  }
  return <AskChat credits={CREDIT_COSTS.ask} aiDisabled={aiMode() === "disabled"} />;
}

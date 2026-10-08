import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchSkeleton } from "@/components/search/search-skeleton";
import { SearchView } from "@/components/search/search-view";
import { PageBody } from "@/components/workspace/page-header";
import { SEARCH_TITLE } from "@/lib/content/copy";
import type { RawSearchParams } from "@/lib/search/params";
import { requireWorkspace } from "@/lib/workspace/context";
import { softFail } from "@/lib/workspace/safe";
import { savedOrgIndex } from "@/lib/workspace/saved";

export const metadata: Metadata = { title: SEARCH_TITLE };

type Props = { searchParams: Promise<RawSearchParams> };

/**
 * Search inside the workspace: the same corpus search as /search, plus a
 * Save button on every result and the natural-language filter bar
 * (`NlFilterBar`, rendered by SearchView in app mode). Results already on
 * the list show as saved.
 */
export default function AppSearchPage({ searchParams }: Props) {
  return (
    <PageBody>
      <Suspense fallback={<SearchSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

async function SearchContent({ searchParams }: Props) {
  const [sp, { user, workspace }] = await Promise.all([searchParams, requireWorkspace()]);
  const savedByOrg = await softFail("saved index", {}, () => savedOrgIndex({ userId: user.id, workspaceId: workspace.id }));
  return <SearchView mode="app" searchParams={sp} plan={workspace.plan} savedByOrg={savedByOrg} />;
}

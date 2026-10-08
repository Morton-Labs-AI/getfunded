import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchSkeleton } from "@/components/search/search-skeleton";
import { SearchView } from "@/components/search/search-view";
import { SEARCH_TAGLINE, SEARCH_TITLE } from "@/lib/content/copy";
import type { RawSearchParams } from "@/lib/search/params";

export const metadata: Metadata = {
  title: SEARCH_TITLE,
  description: SEARCH_TAGLINE,
  robots: { index: true, follow: true },
  alternates: { canonical: "/search" },
};

type Props = { searchParams: Promise<RawSearchParams> };

/** The free public search. The URL is the whole state; no account needed. */
export default function SearchPage({ searchParams }: Props) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <Suspense fallback={<SearchSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchContent({ searchParams }: Props) {
  const sp = await searchParams;
  return <SearchView mode="public" searchParams={sp} />;
}

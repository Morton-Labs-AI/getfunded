import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading shapes for the workspace list pages. Shared by each route's
 * `loading.tsx` (first paint) and the page's own Suspense fallback
 * (navigations with search params), so the two never drift.
 */

export function SavedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your funders">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-2 h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64 max-w-full" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-36" />
        ))}
      </div>
      <div className="mt-4 rounded-lg border bg-card p-3">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="mt-2 h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

export function PipelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the pipeline">
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-2 h-8 w-40" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-64 max-w-full" />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-36" />
        ))}
      </div>
      <div className="mt-4 flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[60vh] w-64 shrink-0" />
        ))}
      </div>
    </div>
  );
}

/** The "Yours" half of a funder page: timeline on the left, tasks and contacts on the right. */
export function YoursSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-busy="true" aria-label="Loading your notes">
      <Skeleton className="h-72 w-full" />
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

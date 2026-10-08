import { Skeleton } from "@/components/ui/skeleton";

/** Loading state for the search page: the shape of the form plus six cards. */
export function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading search">
      <Skeleton className="h-11 w-full" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-36" />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-5 w-24" />
          </li>
        ))}
      </ul>
    </div>
  );
}

import { OutreachPage } from "@/components/outreach/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** The heading block while a page's data streams in. */
export function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between" aria-hidden>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}

/** Tabs plus a few rows: the shape of the queue. */
export function QueueSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading messages">
      <Skeleton className="h-9 w-80 max-w-full" />
      <div className="divide-y rounded-lg border bg-surface">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One or more cards with a few form-height rows. */
export function CardsSkeleton({ cards = 1, rows = 4 }: { cards?: number; rows?: number }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      {Array.from({ length: cards }, (_, c) => (
        <Card key={c}>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-2 h-4 w-full max-w-md" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {Array.from({ length: rows }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** The whole-page fallback used by loading.tsx. */
export function OutreachPageSkeleton() {
  return (
    <OutreachPage>
      <HeaderSkeleton />
      <QueueSkeleton />
    </OutreachPage>
  );
}

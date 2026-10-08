import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAGE_NOT_FOUND_HINT, PAGE_NOT_FOUND_TITLE } from "@/lib/content/copy";

/**
 * 404 inside the workspace shell: a missing saved funder, task, message or
 * import report, or a mistyped /app URL. The navigation stays so the person
 * is not thrown back to the marketing site.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center sm:px-6">
      <SearchX className="size-8 text-ink-4" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold text-foreground">{PAGE_NOT_FOUND_TITLE}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {PAGE_NOT_FOUND_HINT} If this was a saved funder, it may have been archived or removed from the list.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/app/search">Search funders</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app/saved">Saved funders</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/app">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

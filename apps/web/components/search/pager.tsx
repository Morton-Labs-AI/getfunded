import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { MAX_PAGE, searchHref, type SearchParams } from "@/lib/search/params";
import { cn } from "@/lib/utils";

/** Offset pages inside the bounded candidate pool. Zero JS: links only. */
export function Pager({
  params,
  base,
  total,
  pageSize,
}: {
  params: SearchParams;
  base: string;
  total: number;
  pageSize: number;
}) {
  const pages = Math.min(Math.ceil(total / pageSize), MAX_PAGE);
  if (pages <= 1) return null;
  const page = Math.min(Math.max(1, params.page), pages);
  const link = (p: number) => searchHref(base, { ...params, page: p });
  const disabled = "pointer-events-none opacity-50";

  return (
    <nav aria-label="Result pages" className="flex items-center justify-between gap-3">
      <Link
        href={link(page - 1)}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && disabled)}
      >
        <ChevronLeft aria-hidden />
        Previous
      </Link>
      <span className="tnum text-sm text-ink-3">
        Page {page} of {pages}
      </span>
      <Link
        href={link(page + 1)}
        aria-disabled={page >= pages}
        tabIndex={page >= pages ? -1 : undefined}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pages && disabled)}
      >
        Next
        <ChevronRight aria-hidden />
      </Link>
    </nav>
  );
}

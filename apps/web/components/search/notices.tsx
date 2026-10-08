import { Info, TriangleAlert } from "lucide-react";

import {
  GIVING_TO_NOTE,
  NAME_TOO_SHORT_NOTE,
  POOL_BOUNDED_NOTE,
  POSTURE_FILTER_NOTE,
  RATE_LIMITED_NOTE,
  SEMANTIC_UNAVAILABLE_NOTICE,
  TIMED_OUT_NOTE,
} from "@/lib/content/copy";
import type { SearchResult } from "@/lib/queries/corpus/types";
import type { SearchNotice } from "@/lib/search/sql";
import { cn } from "@/lib/utils";

function text(notice: SearchNotice, result: Pick<SearchResult, "poolLimit" | "retryAfterSec">): string {
  switch (notice) {
    case "semantic_unavailable":
      return SEMANTIC_UNAVAILABLE_NOTICE;
    case "name_too_short":
      return NAME_TOO_SHORT_NOTE;
    case "pool_bounded":
      return POOL_BOUNDED_NOTE(result.poolLimit);
    case "posture_filter":
      return POSTURE_FILTER_NOTE;
    case "giving_to_pool":
      return GIVING_TO_NOTE;
    case "rate_limited":
      return RATE_LIMITED_NOTE(result.retryAfterSec ?? 2);
    case "timed_out":
      return TIMED_OUT_NOTE;
  }
}

const WARN: ReadonlySet<SearchNotice> = new Set(["semantic_unavailable", "name_too_short", "rate_limited", "timed_out"]);

/** Honest notices about what the search did and did not do. */
export function SearchNotices({ result }: { result: Pick<SearchResult, "notices" | "poolLimit" | "retryAfterSec"> }) {
  if (result.notices.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Notes about these results">
      {result.notices.map((n) => {
        const warn = WARN.has(n);
        const Icon = warn ? TriangleAlert : Info;
        return (
          <li
            key={n}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]",
              warn ? "border-warning/30 bg-warning-tint text-foreground" : "border-border bg-inset text-ink-2",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", warn ? "text-warning" : "text-ink-3")} aria-hidden />
            <span>{text(n, result)}</span>
          </li>
        );
      })}
    </ul>
  );
}

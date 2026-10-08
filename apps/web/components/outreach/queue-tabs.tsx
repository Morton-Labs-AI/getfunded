import Link from "next/link";

import { OUTREACH_COPY } from "@/lib/outreach/copy";
import { QUEUE_TABS, type QueueTab } from "@/lib/outreach/messages";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Link tabs (server-rendered, no client state): the URL is the state. Scrolls sideways on a phone. */
export function QueueTabs({ active, counts }: { active: QueueTab; counts: Record<QueueTab, number> }) {
  return (
    <nav aria-label="Message queues" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="inline-flex h-9 items-center gap-0.5 rounded-md bg-muted p-[3px] text-muted-foreground">
        {QUEUE_TABS.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab}>
              <Link
                href={tab === "drafts" ? "/app/outreach" : `/app/outreach?tab=${tab}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-[calc(100%-1px)] items-center gap-1.5 rounded-sm border border-transparent px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  isActive ? "bg-surface text-foreground shadow-sm" : "text-ink-2 hover:text-foreground",
                )}
              >
                {OUTREACH_COPY.tabs[tab]}
                <span className="tnum rounded-full bg-inset px-1.5 text-[11px] font-medium text-ink-3">{formatNumber(counts[tab])}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

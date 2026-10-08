import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A FAQ list on native <details>, so it works with no JavaScript and reads
 * well to assistive tech. One item open at a time is not enforced on purpose.
 */
export function Faq({ items, className }: { items: Array<{ q: string; a: React.ReactNode }>; className?: string }) {
  return (
    <div className={cn("divide-y rounded-lg border bg-card shadow-card", className)}>
      {items.map((item) => (
        <details key={item.q} className="group px-4 py-3 open:bg-inset/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
            {item.q}
            <ChevronRight
              className="size-4 shrink-0 text-ink-4 transition-transform duration-150 group-open:rotate-90"
              aria-hidden
            />
          </summary>
          <div className="mt-2 text-sm leading-6 text-pretty text-ink-2">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

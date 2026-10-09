import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoneyCompact } from "@/lib/format";
import type { FunderSignal } from "@/lib/queries/corpus/signals";
import { ACTIONABLE_TYPES, signalTypeLabel } from "@/lib/signals/labels";

/**
 * Dashboard panel: the latest announcements from funders on the list. Facts
 * only (date, who, headline, type, amount); the model's summary stays on the
 * funder page where it carries its AI label.
 */
export function SignalsPanel({ signals }: { signals: FunderSignal[] }) {
  if (signals.length === 0) {
    return <p className="text-sm text-ink-3">No announcements from your saved funders yet. New ones appear here and in the bell.</p>;
  }
  return (
    <ol className="flex flex-col divide-y divide-border/70">
      {signals.map((s) => (
        <li key={s.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <span className="tnum">{s.publishedAt ? formatDate(s.publishedAt) : "Undated"}</span>
            <span aria-hidden>·</span>
            <Badge variant={ACTIONABLE_TYPES.has(s.signalType ?? "") ? "warning" : "secondary"}>{signalTypeLabel(s.signalType)}</Badge>
            {s.amountUsd !== null ? <span className="tnum">{formatMoneyCompact(s.amountUsd)}</span> : null}
          </div>
          <Link href={`/app/funders/${s.orgId}#signals`} className="text-sm font-medium leading-snug text-foreground underline-offset-4 hover:underline">
            {s.orgName ?? s.publisher ?? "Funder"}
          </Link>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-sm leading-snug text-ink-2 underline-offset-4 hover:underline">
            {s.headline ?? s.url}
            <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
          </a>
        </li>
      ))}
    </ol>
  );
}

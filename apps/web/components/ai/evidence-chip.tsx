import * as React from "react";
import { ArrowUpRight, User } from "lucide-react";

import { SourceChip } from "@/components/data/source-chip";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EvidenceItem } from "@/lib/ai/evidence";

/**
 * One cited evidence item, as a chip the reader can open. A Source item
 * (from filings) renders as a <SourceChip /> with the item's text in the
 * provenance slot; a Yours item (the workspace profile, approved knowledge)
 * renders as a Yours badge with the same popover. Both link to the item's
 * row in the panel's evidence list, so every reason is checkable.
 */

const KIND_LABELS: Record<string, string> = {
  identity: "Identity",
  financials: "Financials",
  series: "Giving by year",
  posture: "Application posture",
  application_history: "Application answers over the years",
  standing: "IRS standing",
  grant_stats: "Grant history",
  grant: "Grant",
  geography: "Giving geography",
  similar: "Similar funder",
  website: "Website",
  applicant: "Your profile",
  knowledge: "Approved knowledge",
  dossier: "Web research",
  template: "Your template",
};

export function evidenceAnchor(analysisId: string, itemId: string): string {
  return `evidence-${analysisId}-${itemId}`;
}

export function evidenceLabel(item: EvidenceItem): string {
  return item.source?.label ?? KIND_LABELS[item.kind] ?? item.kind;
}

function EvidenceDetail({ item, analysisId }: { item: EvidenceItem; analysisId: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-mono text-[11px] text-ink-3">[{item.id}]</p>
      <p className="text-sm leading-5 text-ink-2">{item.text}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {item.source?.href ? (
          <a
            href={item.source.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            View source
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        ) : null}
        <a href={`#${evidenceAnchor(analysisId, item.id)}`} className="text-ink-3 hover:text-foreground hover:underline">
          See in evidence list
        </a>
      </div>
    </div>
  );
}

export function EvidenceChip({ item, analysisId, className }: { item: EvidenceItem; analysisId: string; className?: string }) {
  const label = evidenceLabel(item);
  if (item.cls === "source") {
    return <SourceChip label={label} provenance={<EvidenceDetail item={item} analysisId={analysisId} />} className={className} />;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-sm text-left" aria-label={`${label}. Show what this cites`}>
          <Badge variant="yours" data-slot="yours-evidence-chip" className={className}>
            <User aria-hidden />
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-yours">
          <User className="size-3.5" aria-hidden />
          <span className="eyebrow">Yours</span>
        </div>
        <EvidenceDetail item={item} analysisId={analysisId} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The chips for a list of cited ids. Ids that are not in the package never
 * reach storage (lib/ai/fit-schema validates them), so a miss here is a
 * display fallback, not a hidden claim.
 */
export function EvidenceChips({
  ids,
  items,
  analysisId,
  className,
}: {
  ids: ReadonlyArray<string>;
  items: ReadonlyArray<EvidenceItem>;
  analysisId: string;
  className?: string;
}) {
  if (ids.length === 0) return null;
  return (
    <ul className={className ?? "mt-1.5 flex flex-wrap items-center gap-1.5"} aria-label="Evidence cited">
      {ids.map((id) => {
        const item = items.find((i) => i.id === id);
        return (
          <li key={id}>
            {item ? (
              <EvidenceChip item={item} analysisId={analysisId} />
            ) : (
              <code className="rounded-sm border bg-inset px-1.5 py-0.5 font-mono text-[11px] text-ink-3">{id}</code>
            )}
          </li>
        );
      })}
    </ul>
  );
}

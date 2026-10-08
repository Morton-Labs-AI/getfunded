import Link from "next/link";
import { FileCheck, X } from "lucide-react";

import { POSTURE_LABELS } from "@/components/data/posture";
import { NTEE_MAJOR, ORG_TYPE_LABELS } from "@/lib/content/labels";
import { formatEin, formatMoneyCompact } from "@/lib/format";
import { activeFilters, removeFilter, searchHref, type FilterKey, type SearchParams } from "@/lib/search/params";
import { cn } from "@/lib/utils";

function chipLabel(p: SearchParams, key: FilterKey): string {
  switch (key) {
    case "q":
      return p.ein ? `EIN ${formatEin(p.ein)}` : `“${p.q}”`;
    case "givingTo":
      return `Funds organizations like “${p.givingTo}”`;
    case "type":
      return ORG_TYPE_LABELS[p.type] ?? p.type;
    case "state":
      return p.state ?? "";
    case "posture":
      return p.posture ? POSTURE_LABELS[p.posture] : "";
    case "minDistributions":
      return `Gives ${formatMoneyCompact(p.minDistributions)}+ a year`;
    case "minAssets":
      return `Assets ${formatMoneyCompact(p.minAssets)}+`;
    case "ntee":
      return p.ntee ? (NTEE_MAJOR[p.ntee] ?? p.ntee) : "";
  }
}

/**
 * The active-filter row. Every chip is a link that removes its filter.
 * "Funds organizations like" is Source class (it counts real grants), the
 * rest are plain filters; none of them is machine-suggested here.
 */
export function FilterChips({ params, base }: { params: SearchParams; base: string }) {
  const keys = activeFilters(params);
  if (keys.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {keys.map((key) => {
        const evidence = key === "givingTo";
        return (
          <li key={key}>
            <Link
              href={searchHref(base, removeFilter(params, key))}
              title="Remove this filter"
              className={cn(
                "inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-2.5 text-xs font-medium transition-colors duration-150 hover:opacity-80",
                evidence ? "border-source-border bg-source-tint text-source" : "border-primary-border bg-primary-tint text-primary",
              )}
            >
              {evidence ? <FileCheck className="size-3" aria-hidden /> : null}
              {chipLabel(params, key)}
              <X className="size-3" aria-hidden />
              <span className="sr-only">Remove</span>
            </Link>
          </li>
        );
      })}
      {keys.length > 1 ? (
        <li>
          <Link href={base} className="px-1 text-xs text-ink-3 hover:text-foreground">
            Clear all
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

import * as React from "react";
import { FileCheck } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { Missing } from "./missing";

function ProvenancePopover({
  label,
  provenance,
  children,
}: {
  label: string;
  provenance: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-sm text-left" aria-label={`${label}. Show where this came from`}>
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-source">
          <FileCheck className="size-3.5" aria-hidden />
          <span className="eyebrow">Source</span>
        </div>
        {provenance}
      </PopoverContent>
    </Popover>
  );
}

/**
 * SOURCE class chip: names the filing or dataset a value came from
 * ("IRS 990-PF · FY2023"). Teal, document glyph, dotted underline. When a
 * `provenance` slot is given, clicking opens it (usually a <ProvenanceSeal />).
 */
export function SourceChip({
  label,
  provenance,
  className,
}: {
  label: string;
  provenance?: React.ReactNode;
  className?: string;
}) {
  const chip = (
    <span
      data-slot="source-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-source-border bg-source-tint px-1.5 py-0.5 text-xs font-medium text-source",
        className,
      )}
    >
      <FileCheck className="size-3" aria-hidden />
      <span className="data-source">{label}</span>
    </span>
  );
  if (!provenance) return chip;
  return (
    <ProvenancePopover label={label} provenance={provenance}>
      {chip}
    </ProvenancePopover>
  );
}

/**
 * SOURCE class inline value: the verified number or phrase itself, dotted
 * underline, provenance on click. Null renders <Missing bare />.
 */
export function SourceValue({
  children,
  label = "Verified from filings",
  provenance,
  className,
}: {
  children: React.ReactNode;
  label?: string;
  provenance?: React.ReactNode;
  className?: string;
}) {
  if (children === null || children === undefined || children === "") {
    return <Missing bare className={className} />;
  }
  const value = (
    <span data-slot="source-value" className={cn("data-source", className)}>
      {children}
    </span>
  );
  if (!provenance) return value;
  return (
    <ProvenancePopover label={label} provenance={provenance}>
      {value}
    </ProvenancePopover>
  );
}

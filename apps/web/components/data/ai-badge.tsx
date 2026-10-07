import * as React from "react";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * AI class badge: the literal word "AI" plus a sparkle, dashed violet border.
 * Pass `reason` to explain what the model inferred and from what.
 * Nothing machine-suggested renders without this or an <AiCard />.
 */
export function AiBadge({
  label = "AI",
  reason,
  className,
}: {
  label?: string;
  reason?: string;
  className?: string;
}) {
  const badge = (
    <Badge variant="ai" data-slot="ai-badge" className={className}>
      <Sparkles aria-hidden />
      {label}
    </Badge>
  );
  if (!reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-help rounded-sm" aria-label={`${label}, machine-suggested. ${reason}`}>
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <span className="font-medium">Machine-suggested.</span> {reason}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * AI class container: dashed border, violet tint, sparkle glyph (via the
 * .data-ai ::before) and a labelled header. Accept / edit / dismiss
 * affordances for AI output always live inside one of these.
 */
export function AiCard({
  title,
  reason,
  meta,
  className,
  children,
}: {
  title?: string;
  reason?: string;
  /** Right-aligned meta (staleness, evidence count). */
  meta?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="ai-card" className={cn("data-ai p-4", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-3 pr-5">
        <div className="flex items-center gap-2">
          <AiBadge reason={reason} />
          {title ? <h3 className="text-[13px] font-semibold text-foreground">{title}</h3> : null}
        </div>
        {meta}
      </div>
      {children}
    </section>
  );
}

import { Check, Info, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { Missing } from "./missing";

export type PostureValue = "open" | "preselected" | "unknown";

/**
 * Application posture, honestly. `unknown` is the ABSENCE of a statement,
 * not "closed": Form 990 (public charities) has no field for it, so most large
 * grantmaking charities land here. The word "closed" never renders.
 */
export const POSTURE_LABELS: Record<PostureValue, string> = {
  open: "Accepts applications",
  preselected: "Funds preselected organizations only",
  unknown: "Not stated in filings",
};

/** "The latest filing", not "these filings": an earlier return of the same foundation may have stated an answer. */
export const POSTURE_UNKNOWN_EXPLAINER =
  "The latest filing we hold carries no statement about applications. That is not the same as closed: " +
  "public-charity 990s have no field for it, so most large grantmaking charities show this.";

export function Posture({ value, className }: { value: PostureValue | null | undefined; className?: string }) {
  if (!value) return <Missing bare className={className} />;
  const label = POSTURE_LABELS[value];

  if (value === "unknown") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn("cursor-help rounded-sm", className)}
            aria-label={`${label}. Why this is not the same as closed`}
          >
            <Badge variant="outline">
              <Info aria-hidden />
              {label}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{POSTURE_UNKNOWN_EXPLAINER}</TooltipContent>
      </Tooltip>
    );
  }

  if (value === "open") {
    return (
      <Badge variant="success" className={className}>
        <Check aria-hidden />
        {label}
      </Badge>
    );
  }

  return (
    <Badge variant="warning" className={className}>
      <Users aria-hidden />
      {label}
    </Badge>
  );
}

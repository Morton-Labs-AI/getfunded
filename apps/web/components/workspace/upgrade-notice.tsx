import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shown when a plan limit is hit. States the limit in one sentence and
 * offers the plans page; it never blocks what the person can still do.
 */
export function UpgradeNotice({
  message,
  href = "/app/settings/billing",
  linkLabel = "See plans",
  className,
}: {
  message: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-tint px-3 py-2.5 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <span className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>{message}</span>
      </span>
      <Link href={href} className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline">
        {linkLabel}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}

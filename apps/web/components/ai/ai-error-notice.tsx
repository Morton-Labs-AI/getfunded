import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";

import { aiErrorCopy, type AiApiError } from "@/lib/ai/api-client";
import { cn } from "@/lib/utils";

/**
 * How every AI surface says "that did not work": a title, one plain sentence,
 * and a link when the fix is a plan change (credits used up, feature not on
 * the plan). The status role and the icon carry the signal, not the colour.
 */
export function AiErrorNotice({ error, className }: { error: AiApiError; className?: string }) {
  const copy = aiErrorCopy(error);
  const warning = error.kind === "quota" || error.kind === "plan";
  return (
    <div
      role={warning ? "status" : "alert"}
      data-slot="ai-error-notice"
      className={cn(
        "flex flex-col gap-2 rounded-md border px-3 py-2.5 text-sm sm:flex-row sm:items-start sm:justify-between",
        warning ? "border-warning/40 bg-warning-tint text-foreground" : "border-danger/40 bg-danger-tint text-foreground",
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        <Info className={cn("mt-0.5 size-4 shrink-0", warning ? "text-warning" : "text-danger")} aria-hidden />
        <span className="min-w-0">
          <span className="block font-medium">{copy.title}</span>
          {copy.hint ? <span className="block text-ink-2">{copy.hint}</span> : null}
        </span>
      </span>
      {copy.href && copy.linkLabel ? (
        <Link href={copy.href} className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline">
          {copy.linkLabel}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

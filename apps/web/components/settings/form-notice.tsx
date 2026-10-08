"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { ActionState } from "@/lib/settings/actions";
import { cn } from "@/lib/utils";

/** Inline result of a Server Action: the error or the success message, nothing else. */
export function FormNotice({ state, className }: { state: ActionState; className?: string }) {
  if (state.error) {
    return (
      <p role="alert" className={cn("flex items-start gap-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger", className)}>
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{state.error}</span>
      </p>
    );
  }
  if (state.ok && state.message) {
    return (
      <p role="status" className={cn("flex items-start gap-2 rounded-md border border-success/30 bg-success-tint px-3 py-2 text-sm text-success", className)}>
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{state.message}</span>
      </p>
    );
  }
  return null;
}

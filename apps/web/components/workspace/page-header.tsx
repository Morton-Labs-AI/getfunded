import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Page chrome for the workspace: an eyebrow, a title, one plain sentence of
 * help, and the actions. Works at phone width (actions wrap under the title).
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1 text-primary">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div> : null}
    </header>
  );
}

/** Consistent empty and problem states: a title, a hint that says what to do, one action. */
export function EmptyState({
  title,
  hint,
  action,
  tone = "neutral",
  className,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "problem";
  className?: string;
}) {
  return (
    <div
      role={tone === "problem" ? "alert" : undefined}
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center",
        tone === "problem" ? "border-danger/40 bg-danger-tint/40" : "border-border bg-surface",
        className,
      )}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint ? <p className="max-w-md text-sm leading-6 text-ink-3">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Section heading inside a page. */
export function SectionTitle({
  children,
  hint,
  action,
  className,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-end justify-between gap-2", className)}>
      <div>
        <h2 className="text-base font-semibold text-foreground">{children}</h2>
        {hint ? <p className="text-xs leading-5 text-ink-3">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** The workspace page body: a 16px gutter at phone width, more on desktop. */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8", className)}>{children}</div>;
}

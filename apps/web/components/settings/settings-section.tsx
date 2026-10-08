import * as React from "react";

import { cn } from "@/lib/utils";

/** The header every settings tab starts with: a title and one plain sentence. */
export function SettingsSection({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="settings-section" className={cn("flex flex-col gap-5", className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="max-w-prose text-sm leading-6 text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

/** A plain notice box. `tone` picks the status tint; colour is never the only signal (the role and icon slot carry it). */
export function Notice({
  tone = "info",
  title,
  icon,
  className,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: "border-border bg-inset text-ink-2",
    success: "border-success/30 bg-success-tint text-success",
    warning: "border-warning/30 bg-warning-tint text-warning",
    danger: "border-danger/30 bg-danger-tint text-danger",
  } as const;
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      data-slot="notice"
      className={cn("flex gap-3 rounded-md border px-3 py-2.5 text-sm leading-5", tones[tone], className)}
    >
      {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}

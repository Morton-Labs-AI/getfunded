import * as React from "react";

import { cn } from "@/lib/utils";

/** One titled panel on the profile. Same chrome everywhere; sameness is the trust signal. */
export function ProfileSection({
  id,
  title,
  aside,
  note,
  className,
  children,
}: {
  id?: string;
  title: string;
  /** Right-aligned header content (a badge, a count, a seal). */
  aside?: React.ReactNode;
  /** Plain-language caveat under the body. */
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("rounded-lg border bg-card p-4 text-card-foreground shadow-card sm:p-5", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-semibold text-foreground">
          {title}
        </h2>
        {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
      </div>
      {children}
      {note ? <p className="mt-3 text-xs leading-relaxed text-ink-3">{note}</p> : null}
    </section>
  );
}

/**
 * One row of "the basics": a label and its value. `wide` is for a value that
 * is a sentence or a chip: the row then takes the full width of the panel,
 * with the value under the label, so long text is never squeezed.
 */
export type Fact = [label: string, value: React.ReactNode, opts?: { wide?: boolean }];

/** Label / value rows for "the basics". */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {facts.map(([label, value, opts]) =>
        opts?.wide ? (
          <div key={label} className="flex flex-col gap-1 border-b border-border/70 pb-1.5 sm:col-span-2">
            <dt className="text-[13px] text-ink-3">{label}</dt>
            <dd className="min-w-0 text-[13.5px] leading-relaxed text-foreground">{value}</dd>
          </div>
        ) : (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border/70 pb-1.5">
            <dt className="shrink-0 text-[13px] text-ink-3">{label}</dt>
            <dd className="min-w-0 text-right text-[13.5px] text-foreground">{value}</dd>
          </div>
        ),
      )}
    </dl>
  );
}

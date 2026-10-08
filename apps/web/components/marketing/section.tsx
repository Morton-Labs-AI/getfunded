import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Marketing layout primitives. One max width, one gutter, Fraunces for the
 * headline voice. Everything works at phone width first.
 */

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)} {...props} />;
}

export function Section({
  id,
  tone = "canvas",
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & { tone?: "canvas" | "surface" | "inset" }) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-16 py-14 sm:py-20",
        tone === "surface" && "border-y bg-surface",
        tone === "inset" && "border-y bg-inset/60",
        className,
      )}
      {...props}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "left",
  as: Heading = "h2",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: "left" | "center";
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow ? <p className="eyebrow text-primary">{eyebrow}</p> : null}
      <Heading
        className={cn(
          "mt-3 font-display font-medium tracking-tight text-balance text-foreground",
          Heading === "h1" ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl",
        )}
      >
        {title}
      </Heading>
      {lede ? <p className="mt-4 text-lg text-pretty text-muted-foreground">{lede}</p> : null}
    </div>
  );
}

/** Top of every secondary marketing page. */
export function PageHero({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b bg-surface">
      <Container className="py-12 sm:py-16">
        <SectionHeading as="h1" eyebrow={eyebrow} title={title} lede={lede} />
        {children ? <div className="mt-6">{children}</div> : null}
      </Container>
    </div>
  );
}

/** A small note in the reading voice, for drafts and caveats. */
export function Note({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("rounded-md border bg-inset/70 px-3 py-2 text-xs text-ink-3", className)} role="note">
      {children}
    </p>
  );
}

/** Numbered step list for "how it works" blocks. */
export function Steps({ steps }: { steps: Array<{ title: string; body: React.ReactNode }> }) {
  return (
    <ol className="grid gap-6 sm:grid-cols-3">
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-4 sm:flex-col">
          <span
            aria-hidden
            className="tnum grid size-8 shrink-0 place-items-center rounded-full bg-primary-tint font-mono text-sm font-semibold text-primary"
          >
            {i + 1}
          </span>
          <div>
            <h3 className="font-semibold text-foreground">
              <span className="sr-only">Step {i + 1}: </span>
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

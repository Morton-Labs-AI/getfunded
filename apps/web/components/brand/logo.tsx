import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The GetFunded mark: a single leaf, drawn as one lens with a short stem.
 * One colour (currentColor) so it sits on any surface.
 */
export function LeafMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d="M28 4A20 20 0 0 1 8 24A20 20 0 0 1 28 4Z" fill="currentColor" />
      <path d="M8 24 4 28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const SIZES = {
  sm: { mark: "size-5", text: "text-[15px]" },
  md: { mark: "size-6", text: "text-[17px]" },
  lg: { mark: "size-8", text: "text-[22px]" },
  xl: { mark: "size-10", text: "text-[28px]" },
} as const;

export type LogoSize = keyof typeof SIZES;

export function Logo({
  size = "md",
  variant = "full",
  href = "/",
  className,
}: {
  size?: LogoSize;
  variant?: "full" | "mark" | "wordmark";
  /** Pass null to render without a link (inside another link or a heading). */
  href?: string | null;
  className?: string;
}) {
  const s = SIZES[size];
  const content = (
    <span
      data-slot="logo"
      className={cn("inline-flex items-center gap-2 font-semibold tracking-tight text-foreground", className)}
    >
      {variant !== "wordmark" ? (
        <LeafMark className={cn(s.mark, "shrink-0 text-primary")} title={variant === "mark" ? "GetFunded" : undefined} />
      ) : null}
      {variant !== "mark" ? <span className={cn(s.text, "leading-none")}>GetFunded</span> : null}
    </span>
  );
  if (!href) return content;
  return (
    <Link href={href} aria-label="GetFunded home" className="inline-flex rounded-sm">
      {content}
    </Link>
  );
}

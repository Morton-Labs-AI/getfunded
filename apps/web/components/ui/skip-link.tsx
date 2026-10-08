import { cn } from "@/lib/utils";

/**
 * "Skip to content": the first thing a keyboard user tabs to on every page.
 * Invisible until focused, then a button-sized link that jumps past the
 * header and sidebar to <main id="main" tabIndex={-1}>.
 */
export function SkipLink({ href = "#main", className }: { href?: string; className?: string }) {
  return (
    <a
      href={href}
      data-slot="skip-link"
      className={cn(
        "sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-overlay focus:outline-none",
        className,
      )}
    >
      Skip to content
    </a>
  );
}

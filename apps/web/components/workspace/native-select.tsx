import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A styled native <select> for dense surfaces (table cells, kanban cards)
 * where a popover select per row is heavy and the native control is the
 * accessible one: keyboard, screen reader and touch all work for free.
 */
type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  /** Control height. The native `size` (visible rows) attribute is deliberately not exposed. */
  size?: "sm" | "default";
};

export function NativeSelect({ className, children, size = "sm", ...props }: NativeSelectProps) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        data-slot="native-select"
        className={cn(
          "w-full appearance-none rounded-md border border-input bg-surface pr-7 pl-2.5 text-foreground shadow-xs outline-none transition-[color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          size === "sm" ? "h-8 text-[13px]" : "h-9 text-sm",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
    </span>
  );
}

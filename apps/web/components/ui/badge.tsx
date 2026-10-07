import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] duration-150 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary-hover",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        /* The three data classes. Colour + a non-colour signal, always. */
        source: "border-source-border bg-source-tint text-source",
        ai: "border-dashed border-ai-border bg-ai-tint text-ai",
        yours: "border-yours-border border-l-[3px] border-l-yours bg-yours-tint text-yours",
        /* Status */
        success: "border-transparent bg-success-tint text-success",
        warning: "border-transparent bg-warning-tint text-warning",
        danger: "border-transparent bg-danger-tint text-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

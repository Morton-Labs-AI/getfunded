import * as React from "react";
import { User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * YOURS class tag: the workspace's own data (owners, tiers, notes, asks).
 * Brand green with a solid left rule — the one class that is "yours" to edit.
 */
export function YoursTag({
  children,
  label = "Yours",
  className,
}: {
  children?: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <Badge variant="yours" data-slot="yours-tag" className={className}>
      <User aria-hidden />
      {children ?? label}
    </Badge>
  );
}

/** YOURS class container: solid left rule + tint, for relationship blocks. */
export function YoursBlock({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-slot="yours-block" className={cn("data-yours px-3 py-2.5", className)}>
      {title ? <h3 className="eyebrow mb-1.5 text-yours">{title}</h3> : null}
      {children}
    </section>
  );
}

import { formatMoney, formatMoneyCompact, toNumber, type Numeric } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Missing } from "./missing";

/**
 * Money, tabular, with an em dash for null. Never "$0" for missing.
 * Compact values carry the full amount in `title`.
 */
export function Money({
  value,
  compact = false,
  cents = false,
  mono = true,
  className,
}: {
  value: Numeric;
  compact?: boolean;
  cents?: boolean;
  /** JetBrains Mono (default) or inherit the surrounding face. */
  mono?: boolean;
  className?: string;
}) {
  const n = toNumber(value);
  if (n === null) return <Missing bare className={className} />;
  const full = formatMoney(n, { cents });
  const text = compact ? formatMoneyCompact(n) : full;
  return (
    <span data-slot="money" className={cn("tnum", mono && "font-mono", className)} title={compact ? full : undefined}>
      {text}
    </span>
  );
}

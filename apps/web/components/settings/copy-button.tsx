"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button, type buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

/** Copies `value` to the clipboard and says so for two seconds. Falls back to a select-all hint. */
export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "outline",
  size = "sm",
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={copy} className={className} aria-live="polite">
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {failed ? "Select and copy" : copied ? copiedLabel : label}
    </Button>
  );
}

/** A read-only value with a copy button beside it; wraps on phones. */
export function CopyField({ value, label, mono = true }: { value: string; label: string; mono?: boolean }) {
  const id = React.useId();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={`h-9 min-w-0 flex-1 rounded-md border border-input bg-surface px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${mono ? "font-mono" : ""}`}
      />
      <CopyButton value={value} className="shrink-0" />
    </div>
  );
}

import Link from "next/link";
import { countFull } from "@/lib/format";

export function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <div className="flex min-w-[132px] flex-col gap-1 rounded-[10px] border border-border-1 bg-surface px-4 py-3 transition-colors duration-[90ms] hover:border-border-2">
      <span className="mono-label">{label}</span>
      <span className="tnum text-[26px] font-semibold leading-8 tracking-[-0.02em] text-ink-1">
        {countFull(value)}
      </span>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

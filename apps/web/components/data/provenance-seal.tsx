import { ArrowUpRight, ShieldCheck } from "lucide-react";

import { formatDate, formatFiscalYear, shaPrefix } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Missing } from "./missing";

export type Provenance = {
  /** Human dataset name: "IRS 990-PF e-file", "IRS Exempt Orgs BMF". */
  source: string;
  filingYear?: number | string | null;
  /** sha256 of the file we read. When absent the seal leaves the fingerprint out; it never shows a blank. */
  sha256?: string | null;
  /** Link to the public filing or dataset record. */
  href?: string | null;
  license?: string | null;
  retrievedAt?: string | Date | null;
};

function Dot() {
  return (
    <span aria-hidden className="text-ink-4">
      ·
    </span>
  );
}

/**
 * The Provenance Seal: one compact chain-of-custody line behind every sourced
 * fact. Identical everywhere; sameness is the trust signal.
 */
export function ProvenanceSeal({
  source,
  filingYear,
  sha256,
  href,
  license,
  retrievedAt,
  className,
}: Provenance & { className?: string }) {
  return (
    <span
      data-slot="provenance-seal"
      className={cn(
        "inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-source-border bg-source-tint/60 px-2 py-1 text-xs text-ink-2",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1 font-medium text-source">
        <ShieldCheck className="size-3.5" aria-hidden />
        {source}
      </span>
      <Dot />
      <span className="tnum">{filingYear ? formatFiscalYear(filingYear) : <Missing bare />}</span>
      {sha256 ? (
        <>
          <Dot />
          <span className="tnum font-mono text-ink-3" title={`sha256 of the file we read: ${sha256}`}>
            file fingerprint {shaPrefix(sha256)}
          </span>
        </>
      ) : null}
      {license ? (
        <>
          <Dot />
          <span>{license}</span>
        </>
      ) : null}
      {retrievedAt ? (
        <>
          <Dot />
          <span className="text-ink-3">
            Retrieved <time>{formatDate(retrievedAt)}</time>
          </span>
        </>
      ) : null}
      {href ? (
        <>
          <Dot />
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            View filing
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        </>
      ) : null}
    </span>
  );
}

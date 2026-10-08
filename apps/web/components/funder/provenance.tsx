import { ProvenanceSeal } from "@/components/data/provenance-seal";
import { SourceChip } from "@/components/data/source-chip";
import type { Provenance } from "@/lib/queries/corpus/types";

/** The seal for a corpus Provenance, plus the filing id when there is one. */
export function Seal({ p, className }: { p: Provenance; className?: string }) {
  return (
    <div className={className}>
      <ProvenanceSeal source={p.source} filingYear={p.filingYear} sha256={p.sha256} href={p.href} license={p.license} />
      {p.objectId ? (
        <p className="mt-1.5 text-xs text-ink-3">
          Filing id <span className="font-mono text-ink-2">{p.objectId}</span>
        </p>
      ) : null}
    </div>
  );
}

/** A SourceChip whose popover holds the seal. */
export function SourceWithSeal({ label, p, className }: { label: string; p: Provenance; className?: string }) {
  return <SourceChip label={label} provenance={<Seal p={p} />} className={className} />;
}

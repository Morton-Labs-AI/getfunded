import Link from "next/link";
import { moneyCompact } from "@/lib/format";
import { SIMILAR_PROFILES_NOTE } from "@/lib/content/facts";
import type { SimilarOrgRow } from "@/lib/queries/org-profile";

/** Nearest giving profiles by semantic-doc distance. Ordering is the signal;
    the raw distance stays in the tooltip (unitless, invites over-reading). */
export function SimilarPanel({ rows }: { rows: SimilarOrgRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((r, i) => (
          <Link
            key={r.org_id}
            href={`/org/${r.org_id}`}
            title={`affinity rank ${i + 1} · distance ${r.dist.toFixed(4)}`}
            className="group rounded-[10px] border border-border-1 bg-surface px-3 py-2.5 transition-colors hover:border-border-2 hover:bg-raised"
          >
            <div className="truncate text-[12.5px] leading-snug text-ink-1 group-hover:underline">
              {r.name}
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="mono-label">{r.state ?? "—"}</span>
              <span className="tnum font-mono text-[11.5px] text-ink-4">
                {r.size_amount ? moneyCompact(r.size_amount) : "—"}
              </span>
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-ink-4">{SIMILAR_PROFILES_NOTE}</p>
    </div>
  );
}

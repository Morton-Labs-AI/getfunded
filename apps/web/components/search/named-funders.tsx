import Link from "next/link";

import type { NamedFunder } from "@/lib/queries/corpus/types";

/**
 * A short topic can also be a funder's name ("Kresge"). The topic results
 * answer "who funds this"; this line answers "the funder called this", without
 * making either the reader's job to guess.
 */
export function NamedFunders({ q, named, funderBase }: { q: string | null; named: NamedFunder[] | undefined; funderBase: string }) {
  if (!q || !named?.length) return null;
  return (
    <p className="text-[13px] text-ink-3">
      Looking for a funder named “{q}”?{" "}
      {named.map((n, i) => (
        <span key={n.orgId}>
          {i > 0 ? <span className="mx-1 text-ink-4">·</span> : null}
          <Link href={`${funderBase}/${n.orgId}`} className="font-medium text-foreground hover:text-primary hover:underline">
            {n.name}
          </Link>
          {n.state ? <span className="text-ink-4"> ({[n.city, n.state].filter(Boolean).join(", ")})</span> : null}
        </span>
      ))}
    </p>
  );
}

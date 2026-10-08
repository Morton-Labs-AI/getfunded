import Link from "next/link";
import { Building2, FileCheck, HandCoins, Landmark } from "lucide-react";

import { POSTURE_LABELS } from "@/components/data/posture";
import { StatTile } from "@/components/data/stat-tile";
import { EMPTY_SEARCH_HINT, EMPTY_SEARCH_TITLE, EXAMPLE_QUERIES } from "@/lib/content/copy";
import { formatCompact, formatDate } from "@/lib/format";
import type { CorpusCounts } from "@/lib/queries/corpus/types";
import { searchHref, withParams, DEFAULT_SEARCH_PARAMS } from "@/lib/search/params";

/** The search page before anything has been asked. */
export function SearchLanding({ base, counts }: { base: string; counts: CorpusCounts | null }) {
  const foundations = counts?.byType.private_foundation ?? null;
  const charities = counts?.byType.public_charity ?? null;
  const open = counts?.byPosture.open ?? null;
  return (
    <section className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-semibold text-foreground">{EMPTY_SEARCH_TITLE}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{EMPTY_SEARCH_HINT}</p>
      </div>

      <div>
        <p className="eyebrow mb-2 text-muted-foreground">Try one</p>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLE_QUERIES.map((q) => (
            <li key={q}>
              <Link
                href={searchHref(base, withParams(DEFAULT_SEARCH_PARAMS, { q }))}
                className="inline-flex rounded-full border bg-surface px-3 py-1 text-sm text-ink-2 transition-colors duration-150 hover:border-primary-border hover:text-foreground"
              >
                {q}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Private foundations"
          value={foundations === null ? null : formatCompact(foundations)}
          icon={Landmark}
          href={searchHref(base, withParams(DEFAULT_SEARCH_PARAMS, { type: "private_foundation" }))}
          hint="Most file Form 990-PF, which states whether they take applications."
        />
        <StatTile
          label="Public charities"
          value={charities === null ? null : formatCompact(charities)}
          icon={Building2}
          href={searchHref(base, withParams(DEFAULT_SEARCH_PARAMS, { type: "public_charity" }))}
          hint="Searchable by name. Many are grantmakers; their filings do not state an application policy."
        />
        <StatTile
          label={POSTURE_LABELS.open}
          value={open === null ? null : formatCompact(open)}
          icon={HandCoins}
          href={searchHref(base, withParams(DEFAULT_SEARCH_PARAMS, { posture: "open" }))}
          hint="Say so on their latest Form 990-PF, Part XV."
        />
      </div>

      <p className="inline-flex items-center gap-1.5 text-xs text-ink-3">
        <FileCheck className="size-3.5 text-source" aria-hidden />
        Counts come from public IRS filings
        {counts?.refreshedAt ? <> · last refreshed {formatDate(counts.refreshedAt)}</> : null}
      </p>
    </section>
  );
}

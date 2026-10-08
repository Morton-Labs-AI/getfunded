import Link from "next/link";

import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { SIMILAR_FUNDERS_NOTE, SIMILAR_FUNDERS_TITLE } from "@/lib/content/copy";
import { orgTypeLabel } from "@/lib/content/labels";
import type { SimilarFunder } from "@/lib/queries/corpus/types";

import { ProfileSection } from "./profile-section";

export function SimilarFunders({ rows, funderBase }: { rows: SimilarFunder[]; funderBase: string }) {
  return (
    <ProfileSection id="similar" title={SIMILAR_FUNDERS_TITLE} note={rows.length > 0 ? SIMILAR_FUNDERS_NOTE : undefined}>
      {rows.length === 0 ? (
        <p className="text-sm">
          <Missing kind="no-public-data" />
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={r.orgId} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0">
                <Link href={`${funderBase}/${r.orgId}`} className="text-foreground hover:text-primary hover:underline" title={`Rank ${i + 1} by giving-profile similarity`}>
                  {r.name}
                </Link>
                <span className="ml-1.5 text-xs text-ink-4">{orgTypeLabel(r.orgType)}</span>
              </span>
              <span className="tnum shrink-0 text-ink-3">
                {r.state ? `${r.state} · ` : ""}
                <Money value={r.sizeAmount} compact mono={false} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </ProfileSection>
  );
}

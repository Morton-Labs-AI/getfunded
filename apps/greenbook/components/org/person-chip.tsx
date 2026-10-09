import Link from "next/link";
import { REL_LABEL } from "@/lib/format";
import type { PersonChip } from "@/lib/queries/orgs";

/** One person chip, linked to their person page.
 *
 * Single definition on purpose: this markup previously existed twice — inline
 * on the org page and again inside PeopleGroups — and the copies drifted, so
 * linking people to /person/[id] silently missed foundation profiles (the only
 * org type that renders via PeopleGroups). Both paths now render this. */
export function PersonChipEl({ p }: { p: PersonChip }) {
  return (
    <Link
      href={`/person/${p.person_id}`}
      className="inline-flex items-center gap-2 rounded-[8px] border border-border-1 bg-surface px-2.5 py-1.5 transition-colors duration-[90ms] hover:border-border-2"
      title={`${p.title ?? REL_LABEL[p.rel_type] ?? p.rel_type} · source: ${p.dataset_name}`}
    >
      <span className="text-[13px] font-medium text-ink-1">{p.full_name}</span>
      <span className="mono-label normal-case tracking-[0.04em]">
        {(p.title ?? REL_LABEL[p.rel_type] ?? "").toLowerCase().slice(0, 26)}
      </span>
    </Link>
  );
}

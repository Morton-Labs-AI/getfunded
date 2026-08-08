import { PERSON_CAVEAT } from "@/lib/content/facts";
import { PersonChipEl } from "@/components/org/person-chip";
import type { PersonChip } from "@/lib/queries/orgs";

const GROUPS: { rel: string; heading: string }[] = [
  { rel: "owner_of", heading: "owners" },
  { rel: "officer_of", heading: "officers" },
  { rel: "trustee_of", heading: "trustees" },
  { rel: "director_of", heading: "directors" },
];

/** People chips bucketed by relationship type (presentational only —
    orgPeople already orders by role rank, this just adds headings). */
export function PeopleGroups({ people }: { people: PersonChip[] }) {
  if (people.length === 0) return null;
  const known = new Set(GROUPS.map((g) => g.rel));
  const buckets = GROUPS.map((g) => ({
    heading: g.heading,
    people: people.filter((p) => p.rel_type === g.rel),
  })).filter((b) => b.people.length > 0);
  const other = people.filter((p) => !known.has(p.rel_type));
  if (other.length > 0) buckets.push({ heading: "other", people: other });

  return (
    <div>
      <div className="flex flex-col gap-4">
        {buckets.map((b) => (
          <div key={b.heading}>
            <div className="mono-label mb-2">{b.heading}</div>
            <div className="flex flex-wrap gap-2">
              {b.people.map((p) => (
                <PersonChipEl key={p.person_id} p={p} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-ink-4">{PERSON_CAVEAT}</p>
    </div>
  );
}

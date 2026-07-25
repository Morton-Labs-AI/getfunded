import Link from "next/link";
import { listPrograms } from "@/lib/queries/programs";
import { moneyCompact, MDASH } from "@/lib/format";

export const metadata = { title: "Federal programs — Open Funder Database" };

export default async function ProgramsPage() {
  const programs = await listPrograms();
  const byAgency = new Map<string, typeof programs>();
  for (const p of programs) {
    const list = byAgency.get(p.agency_name) ?? [];
    list.push(p);
    byAgency.set(p.agency_name, list);
  }

  return (
    <div className="page-enter mx-auto w-full max-w-[1200px] px-6 pb-16 pt-10">
      <span className="mono-label">federal non-dilutive</span>
      <h1 className="mt-2 text-[26px] font-[650] tracking-[-0.02em] text-ink-1">
        Federal funding programs
      </h1>
      <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-ink-2">
        A curated seed of {programs.length} programs relevant to deep-tech and
        public-benefit companies — the funder-side records a naive scrape gets
        wrong. Award figures are curated estimates pending founder review.
      </p>

      <div className="mt-8 flex flex-col gap-10">
        {[...byAgency.entries()].map(([agency, list]) => (
          <section key={agency}>
            <div className="mb-3 flex items-baseline gap-3">
              <Link
                href={`/org/${list[0].agency_id}`}
                className="text-[19px] font-semibold tracking-[-0.015em] text-ink-1 hover:text-accent"
              >
                {agency}
              </Link>
              <span className="mono-label">{list.length} programs</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {list.map((p) => (
                <Link
                  key={p.id}
                  href={`/programs/${p.id}`}
                  className="group flex flex-col gap-2 rounded-[10px] border border-border-1 bg-surface p-4 transition-colors duration-[90ms] hover:border-border-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[15px] font-semibold leading-5 text-ink-1 group-hover:text-accent">
                      {p.name}
                    </span>
                    <span className="mono-label shrink-0 rounded-[5px] px-1.5 py-0.5"
                      style={{ background: "var(--cat-federal-tint)", color: "var(--cat-federal)" }}>
                      {p.program_type}
                    </span>
                  </div>
                  {p.description && (
                    <p className="text-[13px] leading-5 text-ink-3">
                      {p.description.slice(0, 140)}
                      {p.description.length > 140 ? "…" : ""}
                    </p>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    {p.non_dilutive && (
                      <span className="mono-label rounded-[5px] bg-accent-tint px-1.5 py-0.5 normal-case tracking-[0.04em]"
                        style={{ color: "var(--accent)" }}>
                        non-dilutive
                      </span>
                    )}
                    {p.funds_lab_not_company && (
                      <span
                        className="mono-label rounded-[5px] px-1.5 py-0.5 normal-case tracking-[0.04em]"
                        style={{ background: "color-mix(in srgb, var(--caution) 12%, transparent)", color: "var(--caution)" }}
                        title="This program pays a national lab to work on your behalf — the company does not receive the money directly."
                      >
                        funds a national lab on your behalf
                      </span>
                    )}
                    <span className="tnum ml-auto font-mono text-[11px] text-ink-4">
                      {p.award_floor || p.award_ceiling
                        ? `${p.award_floor ? moneyCompact(p.award_floor) : MDASH}–${p.award_ceiling ? moneyCompact(p.award_ceiling) : MDASH}`
                        : p.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

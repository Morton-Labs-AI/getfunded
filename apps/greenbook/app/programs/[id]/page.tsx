import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProgram,
  programAwards,
  programAwardsByYear,
  programAwardCount,
} from "@/lib/queries/programs";
import { SourceGlyph } from "@/components/source-glyph";
import { YearBars } from "@/components/year-bars";
import { moneyCompact, moneyFull, countFull, MDASH } from "@/lib/format";

export default async function ProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const program = await getProgram(id);
  if (!program) notFound();

  const [awards, byYear, count] = await Promise.all([
    programAwards(id),
    programAwardsByYear(id),
    programAwardCount(id),
  ]);

  const prov = {
    dataset: program.dataset_name,
    sourceUrl: program.source_url,
    sha256: program.sha256,
    license: program.license_name,
    locator: program.source_record_locator,
    ingested: program.downloaded_at,
  };

  return (
    <div className="page-enter mx-auto w-full max-w-[1200px] px-6 pb-16 pt-10">
      <div className="flex items-center justify-between gap-3">
        <span className="mono-label">
          <Link href={`/org/${program.agency_id}`} className="hover:text-ink-1">
            {program.agency_name}
          </Link>{" "}
          · {program.program_type} · {program.status}
        </span>
        <Link
          href={`/?q=${encodeURIComponent(`Tell me about the ${program.name} program (program id ${program.id}) — who has won awards and at what scale?`)}`}
          className="rounded-[8px] border border-accent-border px-3 py-1.5 text-[12.5px] font-medium text-accent transition-colors duration-[90ms] hover:bg-accent-tint"
        >
          Ask about this program
        </Link>
      </div>
      <h1 className="mt-2 text-[26px] font-[650] tracking-[-0.02em] text-ink-1">
        {program.name}
      </h1>
      <div className="mt-3 flex flex-wrap gap-2">
        {program.non_dilutive && (
          <span className="mono-label rounded-[5px] bg-accent-tint px-2 py-1 normal-case" style={{ color: "var(--accent)" }}>
            non-dilutive
          </span>
        )}
        {program.funds_lab_not_company && (
          <span
            className="mono-label rounded-[5px] px-2 py-1 normal-case"
            style={{ background: "color-mix(in srgb, var(--caution) 12%, transparent)", color: "var(--caution)" }}
          >
            funds a national lab on your behalf — not the company directly
          </span>
        )}
        {program.url && (
          <a href={program.url} target="_blank" rel="noreferrer" className="text-[12.5px] text-accent hover:text-accent-hover">
            program site ↗
          </a>
        )}
      </div>
      <div className="mt-5 h-[2px] w-full" style={{ background: "var(--cat-federal)" }} />

      <div className="grid grid-cols-1 gap-8 py-6 md:grid-cols-3">
        <div className="md:col-span-2">
          {program.description && (
            <p className="text-[15px] leading-6 text-ink-2">{program.description}</p>
          )}
          {program.eligibility && (
            <p className="mt-3 text-[13.5px] leading-5 text-ink-3">
              <span className="mono-label">eligibility · </span>
              {program.eligibility}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <span className="mono-label">award range</span>
            <div className="tnum mt-1 text-[22px] font-semibold text-ink-1">
              {program.award_floor || program.award_ceiling ? (
                <SourceGlyph prov={prov}>
                  {`${program.award_floor ? moneyCompact(program.award_floor) : MDASH} – ${program.award_ceiling ? moneyCompact(program.award_ceiling) : MDASH}`}
                </SourceGlyph>
              ) : (
                <span className="text-ink-4">{MDASH}</span>
              )}
            </div>
          </div>
          {count.n > 0 && (
            <div>
              <span className="mono-label">linked awards on file</span>
              <div className="tnum mt-1 text-[22px] font-semibold text-ink-1">
                {countFull(count.n)}
                <span className="ml-2 text-[13.5px] font-normal text-ink-3">
                  · {moneyCompact(count.total)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {byYear.length > 0 && (
        <div className="flex border-t border-border-1 pt-6">
          <YearBars data={byYear} fill="var(--cat-federal-fill)" unitLabel="awards" />
        </div>
      )}

      {awards.length > 0 && (
        <section className="py-7">
          <h2 className="mb-4 text-[19px] font-semibold tracking-[-0.015em] text-ink-1">
            Recent awards
          </h2>
          <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-raised">
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">recipient</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">award</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">amount</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">fy</th>
                </tr>
              </thead>
              <tbody>
                {awards.map((a) => (
                  <tr key={a.id} className="border-b border-border-1 align-top last:border-0">
                    <td className="max-w-[240px] px-3.5 py-2">
                      {a.recipient_org_id ? (
                        <Link href={`/org/${a.recipient_org_id}`} className="font-medium text-accent hover:text-accent-hover">
                          {a.recipient_name}
                        </Link>
                      ) : (
                        <span className="as-reported">{a.recipient_name}</span>
                      )}
                      {a.recipient_state && (
                        <span className="text-ink-4"> · {a.recipient_state}</span>
                      )}
                    </td>
                    <td className="max-w-[400px] px-3.5 py-2 text-ink-3">
                      {a.purpose_text ? a.purpose_text.slice(0, 100) : MDASH}
                    </td>
                    <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                      {a.amount ? moneyFull(a.amount) : MDASH}
                    </td>
                    <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                      {a.fiscal_year ?? MDASH}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

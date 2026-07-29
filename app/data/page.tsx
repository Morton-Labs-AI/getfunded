import { sql } from "@/lib/db";
import { OpenRing } from "@/components/open-ring";
import { hashShort, countFull, dateShort, moneyCompact } from "@/lib/format";
import { KNOWN_LIMITS } from "@/lib/content/facts";

export const metadata = { title: "Data & provenance — Open Funder Database" };

function wilsonLow(correct: number, n: number): number {
  if (n === 0) return 0;
  const p = correct / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - margin) / denom;
}

export default async function DataPage() {
  const [files, coverage, erTiers, erLinks, erLabels, erApplied] = await Promise.all([
    sql`
      select rf.dataset_name, count(*)::int as files,
             sum(rf.byte_size)::text as bytes,
             min(rf.downloaded_at)::text as first_dl,
             max(rf.downloaded_at)::text as last_dl,
             lm.license_name, lm.republishable,
             max(rf.source_url) as sample_url,
             max(rf.sha256) as sample_sha
      from internal.raw_files rf
      join internal.licensing_map lm on lm.license_code = rf.license_code
      group by rf.dataset_name, lm.license_name, lm.republishable
      order by rf.dataset_name`,
    sql`
      select 'organizations' as t, orgs::text as n from internal.mv_overview_totals
      union all select 'people', people::text from internal.mv_overview_totals
      union all select 'funding_events', events::text from internal.mv_overview_totals
      union all select 'relationships', relationships::text from internal.mv_overview_totals
      union all select 'funding_programs', programs::text from internal.mv_overview_totals
      union all select 'org_identifiers', count(*)::text from internal.org_identifiers
      union all select 'contact_channels (all internal-only)', count(*)::text from internal.contact_channels`,
    sql`
      select method, status, count(*)::int as n
      from internal.recipient_matches group by 1, 2 order by 1, 2`,
    sql`
      select job, status, count(*)::int as n
      from internal.entity_links group by 1, 2 order by 1, 2`,
    sql`
      select job, count(*) filter (where label = 'match')::int as correct,
             count(*)::int as n
      from internal.er_labels where label <> 'unsure' group by 1 order by 1`,
    sql`
      select
        (select coalesce(sum(n), 0) from internal.mv_recipient_event_stats
          where event_type = 'grant')::int as grants_linked,
        (select coalesce(sum(total), 0) from internal.mv_recipient_event_stats
          where event_type = 'grant')::text as dollars_linked,
        (select count(*) from internal.organizations
          where canonical_org_id is not null)::int as orgs_merged,
        (select count(*) from internal.people
          where canonical_person_id is not null)::int as people_merged`,
  ]);
  const applied = erApplied[0];

  return (
    <div className="page-enter mx-auto w-full max-w-[1200px] px-6 pb-16 pt-10">
      <span className="mono-label">the trust page</span>
      <h1 className="mt-2 text-[26px] font-[650] tracking-[-0.02em] text-ink-1">
        Data &amp; provenance
      </h1>
      <p
        className="mt-3 max-w-[68ch] text-[17px] leading-7 text-ink-2"
        style={{ fontFamily: "var(--font-newsreader)" }}
      >
        Every fact in this database traces to a sha256-hashed public filing:
        dataset → source URL → immutable file → license → ingestion run. Nothing
        here was scraped from behind a login; nothing came from a commercial
        data vendor. The provenance contract is the product.
      </p>

      <section className="mt-10">
        <h2 className="mb-3 text-[19px] font-semibold tracking-[-0.015em] text-ink-1">
          Source inventory
        </h2>
        <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-raised">
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">dataset</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">files</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">license</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">republishable</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">acquired</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">sample sha256</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.dataset_name as string} className="border-b border-border-1 last:border-0">
                    <td className="whitespace-nowrap px-3.5 py-2 font-mono text-[12px] text-ink-1">
                      {f.dataset_name as string}
                    </td>
                    <td className="tnum px-3.5 py-2 text-right font-mono text-[12px] text-ink-2">
                      {f.files as number}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2 text-ink-2">{f.license_name as string}</td>
                    <td className="px-3.5 py-2">
                      {f.republishable ? (
                        <span style={{ color: "var(--positive)" }}>yes</span>
                      ) : (
                        <span style={{ color: "var(--caution)" }}>internal only</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2 font-mono text-[11px] text-ink-3">
                      {dateShort(f.last_dl as string)}
                    </td>
                    <td className="px-3.5 py-2 font-mono text-[11px] text-ink-4">
                      {hashShort(f.sample_sha as string)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="mt-10 grid grid-cols-1 gap-10 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-[19px] font-semibold tracking-[-0.015em] text-ink-1">
            Coverage
          </h2>
          <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
            <table className="w-full text-[13px]">
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.t as string} className="border-b border-border-1 last:border-0">
                    <td className="px-3.5 py-2 font-mono text-[12px] text-ink-2">{c.t as string}</td>
                    <td className="tnum px-3.5 py-2 text-right font-mono text-[12px] text-ink-1">
                      {countFull(c.n as string)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[19px] font-semibold tracking-[-0.015em] text-ink-1">
            Known limits
          </h2>
          <ul className="flex flex-col gap-2.5">
            {KNOWN_LIMITS.map((l, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] leading-5 text-ink-3">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-4" />
                {l}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-[19px] font-semibold tracking-[-0.015em] text-ink-1">
          Entity resolution
        </h2>
        <p className="mb-4 max-w-[74ch] text-[13.5px] leading-6 text-ink-3">
          Linkage is non-destructive: candidate links are staged in{" "}
          <span className="font-mono text-[12.5px]">entity_links</span>, human
          labels permanently override machine decisions, and merges only apply
          after a precision gate (≥100 labels, 95% Wilson lower bound &gt;
          0.90) certifies the class being merged. Unmatched grant recipients
          stay as-reported; placeholder entries are never matched or stubbed.{" "}
          {countFull(applied.grants_linked as number)} grant rows (
          {moneyCompact(applied.dollars_linked as string)}) carry a resolved
          recipient · {countFull(applied.orgs_merged as number)} org records
          and {countFull(applied.people_merged as number)} person records
          currently merged into canonical entities.
        </p>
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <div>
            <h3 className="mono-label mb-2">recipient matching (by tier)</h3>
            <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
              <table className="w-full text-[13px]">
                <tbody>
                  {erTiers.map((r) => (
                    <tr key={`${r.method}-${r.status}`} className="border-b border-border-1 last:border-0">
                      <td className="px-3.5 py-2 font-mono text-[12px] text-ink-2">{r.method as string}</td>
                      <td className="px-3.5 py-2 font-mono text-[12px] text-ink-3">{r.status as string}</td>
                      <td className="tnum px-3.5 py-2 text-right font-mono text-[12px] text-ink-1">
                        {countFull(r.n as number)}
                      </td>
                    </tr>
                  ))}
                  {erTiers.length === 0 && (
                    <tr><td className="px-3.5 py-2 text-[12.5px] text-ink-4">no matches computed yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="mono-label mb-2">link jobs &amp; precision gates</h3>
            <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
              <table className="w-full text-[13px]">
                <tbody>
                  {erLinks.map((r) => (
                    <tr key={`${r.job}-${r.status}`} className="border-b border-border-1 last:border-0">
                      <td className="px-3.5 py-2 font-mono text-[12px] text-ink-2">{r.job as string}</td>
                      <td className="px-3.5 py-2 font-mono text-[12px] text-ink-3">{r.status as string}</td>
                      <td className="tnum px-3.5 py-2 text-right font-mono text-[12px] text-ink-1">
                        {countFull(r.n as number)}
                      </td>
                    </tr>
                  ))}
                  {erLabels.map((r) => {
                    const low = wilsonLow(r.correct as number, r.n as number);
                    return (
                      <tr key={`labels-${r.job}`} className="border-b border-border-1 last:border-0">
                        <td className="px-3.5 py-2 font-mono text-[12px] text-ink-2">{r.job as string}</td>
                        <td className="px-3.5 py-2 font-mono text-[12px] text-ink-3">
                          human labels · Wilson low {low.toFixed(3)}
                        </td>
                        <td className="tnum px-3.5 py-2 text-right font-mono text-[12px] text-ink-1">
                          {r.correct as number}/{r.n as number}
                        </td>
                      </tr>
                    );
                  })}
                  {erLinks.length === 0 && erLabels.length === 0 && (
                    <tr><td className="px-3.5 py-2 text-[12.5px] text-ink-4">no link jobs run yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-12 flex items-center gap-2.5 border-t border-border-1 pt-6">
        <OpenRing size={16} />
        <span className="text-[12.5px] text-ink-4">
          Acquisition is aggressive; republication is conservative. Contact
          data never leaves the internal tier. Read-only, local.
        </span>
      </footer>
    </div>
  );
}

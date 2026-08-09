import { FyBars, type FyBarDatum } from "@/components/fy-bars";
import { BreakdownBars } from "@/components/breakdown-bars";
import { SourceGlyph, type Provenance } from "@/components/source-glyph";
import { FILING_AS_FILED_NOTE } from "@/lib/content/facts";
import { moneyFull, moneyRegister, MDASH } from "@/lib/format";
import type { FilingRow } from "@/lib/queries/filings";

/** ProPublica-style financial trends for a grantmaker profile: four
    single-series FY micro-charts (revenue / expenses / total assets /
    total liabilities) + the latest filing's revenue/expense composition.
    Series use non-superseded filings only — where an original and its
    amendment share a tax period, only the amendment contributes. */
export function FinancialTrends({ filings }: { filings: FilingRow[] }) {
  const live = filings
    .filter((f) => f.superseded_by_object_id === null && f.has_financials)
    .sort((a, b) => (a.fy ?? 0) - (b.fy ?? 0));
  if (live.length === 0) return null;
  const latest = live[live.length - 1];

  const provFor = (f: FilingRow): Provenance => ({
    dataset: f.dataset_name,
    sourceUrl: f.source_url,
    sha256: f.sha256,
    license: f.license_name,
    locator: f.object_id,
    ingested: f.downloaded_at,
  });

  const series = (pick: (f: FilingRow) => string | null): FyBarDatum[] =>
    live
      .filter((f) => f.fy !== null)
      .map((f) => ({
        fy: f.fy as number,
        value: pick(f),
        href: `/filing/${f.object_id}`,
      }));

  const metrics: { label: string; pick: (f: FilingRow) => string | null }[] = [
    { label: "revenue", pick: (f) => f.total_revenue },
    { label: "expenses", pick: (f) => f.total_expenses },
    { label: "total assets", pick: (f) => f.total_assets_eoy },
    { label: "total liabilities", pick: (f) => f.total_liabilities_eoy },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        {metrics.map((m) => {
          const latestVal = m.pick(latest);
          const reg = moneyRegister(latestVal);
          return (
            <div key={m.label} className="flex flex-col gap-2">
              <span className="mono-label">{`${m.label} · FY${latest.fy}`}</span>
              <SourceGlyph prov={provFor(latest)}>
                {reg ? (
                  <span
                    className="tnum text-[22px] font-[620] leading-7 tracking-[-0.02em] text-ink-1"
                    title={latestVal ? moneyFull(latestVal) : undefined}
                  >
                    <span className="text-[0.72em] font-medium text-ink-3">{reg.symbol}</span>
                    {reg.digits}
                    <span className="text-[0.72em] font-medium text-ink-3">{reg.suffix}</span>
                  </span>
                ) : (
                  <span className="text-[22px] font-[620] leading-7 text-ink-4">{MDASH}</span>
                )}
              </SourceGlyph>
              <FyBars data={series(m.pick)} fill="var(--cat-grant-fill)" />
            </div>
          );
        })}
      </div>

      <div className="mt-7 grid gap-8 md:grid-cols-2">
        <div>
          <div className="mono-label mb-2.5">{`where the money came from · FY${latest.fy} as filed`}</div>
          <BreakdownBars
            fill="var(--cat-grant-fill)"
            total={latest.total_revenue}
            rows={[
              { label: "contributions received", value: latest.contributions_received },
              { label: "dividends", value: latest.dividends },
              { label: "interest", value: latest.interest_income },
              { label: "net gain on asset sales", value: latest.net_gain_sale_assets },
              { label: "other income", value: latest.other_income },
            ]}
          />
        </div>
        <div>
          <div className="mono-label mb-2.5">{`where it went · FY${latest.fy} as filed`}</div>
          <BreakdownBars
            fill="var(--cat-grant-fill)"
            total={latest.total_expenses}
            rows={[
              { label: "contributions & grants paid", value: latest.contributions_paid },
              { label: "charitable disbursements (total)", value: latest.charitable_disbursements },
              { label: "officer compensation", value: latest.officer_comp },
              { label: "operating expenses", value: latest.total_operating_expenses },
            ]}
          />
        </div>
      </div>
      <p className="mt-4 text-[11.5px] text-ink-4">{FILING_AS_FILED_NOTE}</p>
    </div>
  );
}

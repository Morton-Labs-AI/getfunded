import Link from "next/link";
import { SourceGlyph } from "@/components/source-glyph";
import { moneyFull, countFull, MDASH } from "@/lib/format";
import type { FilingRow } from "@/lib/queries/filings";

/** Filings-by-year table for an org profile. Superseded rows stay listed —
    the original return remains viewable — but dimmed, chipped, and pointing
    at their amendment. Net income is computed (revenue − expenses); the
    revenue cell carries the per-filing provenance seal. */
export function FilingsList({
  filings,
  grantCounts,
}: {
  filings: FilingRow[];
  grantCounts: Map<string, number>;
}) {
  if (filings.length === 0) return null;
  const returnLabel = (rt: string) =>
    rt === "990PF" ? "990-PF" : rt === "990EZ" ? "990-EZ" : rt;

  return (
    <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-raised">
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">fiscal year</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">return</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">revenue</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">expenses</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">net income</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">net assets</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">grants</th>
            </tr>
          </thead>
          <tbody>
            {filings.map((f) => {
              const superseded = f.superseded_by_object_id !== null;
              const net =
                f.total_revenue !== null && f.total_expenses !== null
                  ? String(Number(f.total_revenue) - Number(f.total_expenses))
                  : null;
              const netN = net !== null ? Number(net) : null;
              const grants = grantCounts.get(f.object_id) ?? 0;
              return (
                <tr
                  key={f.object_id}
                  className={`border-b border-border-1 align-top last:border-0${superseded ? " opacity-60" : ""}`}
                >
                  <td className="whitespace-nowrap px-3.5 py-2">
                    <Link
                      href={`/filing/${f.object_id}`}
                      className="font-medium text-accent hover:text-accent-hover"
                    >
                      {f.fy ? `FY${f.fy}` : f.object_id}
                    </Link>
                    {f.tax_period_end && (
                      <span className="ml-2 text-[12px] text-ink-4">
                        ended {f.tax_period_end.slice(0, 7)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2">
                    <span className="rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[10.5px] tracking-[0.08em] text-ink-3">
                      {returnLabel(f.return_type)}
                    </span>
                    {f.amended_return && (
                      <span
                        className="ml-1.5 rounded-[5px] px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em]"
                        style={{
                          background: "color-mix(in srgb, var(--caution) 12%, transparent)",
                          color: "var(--caution)",
                        }}
                      >
                        amended
                      </span>
                    )}
                    {superseded && (
                      <Link
                        href={`/filing/${f.superseded_by_object_id}`}
                        className="ml-1.5 rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink-1"
                        title="A later return supersedes this one — figures shown are as originally filed"
                      >
                        superseded →
                      </Link>
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                    {f.has_financials ? (
                      <SourceGlyph
                        prov={{
                          dataset: f.dataset_name,
                          sourceUrl: f.source_url,
                          sha256: f.sha256,
                          license: f.license_name,
                          locator: f.object_id,
                          ingested: f.downloaded_at,
                        }}
                      >
                        {moneyFull(f.total_revenue)}
                      </SourceGlyph>
                    ) : (
                      MDASH
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                    {moneyFull(f.total_expenses)}
                  </td>
                  <td
                    className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px]"
                    style={{
                      color: netN !== null && netN < 0 ? "var(--negative)" : "var(--ink-1)",
                    }}
                  >
                    {moneyFull(net)}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                    {moneyFull(f.net_assets_eoy)}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                    {grants > 0 ? countFull(grants) : MDASH}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

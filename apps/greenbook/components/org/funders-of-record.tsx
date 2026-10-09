import Link from "next/link";
import { moneyFull, countFull, MDASH } from "@/lib/format";
import type { FunderOfRecord } from "@/lib/queries/contacts";

/** Who has funded this organization, and for how long — the questions a
    program officer actually asks when vetting a prospective grantee. The
    concentration share answers "how dependent are they on one funder", which
    is the one financial-health signal we can give without the 990 core form. */
export function FundersOfRecord({ rows }: { rows: FunderOfRecord[] }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const topShare = total > 0 ? Math.round((100 * Number(rows[0].total ?? 0)) / total) : null;
  const lastFy = Math.max(...rows.map((r) => r.last_fy ?? 0));

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-3">
        <span>
          {`${countFull(rows.length)} funder${rows.length > 1 ? "s" : ""} on file`}
        </span>
        {topShare !== null && (
          <span title="Share of tracked grant dollars from the single largest funder">
            {`largest funder = ${topShare}% of tracked dollars`}
          </span>
        )}
        {lastFy > 0 && (
          <span title="The most recent fiscal year with a grant on file — not a statement that funding is current">
            {`last grant on file: FY${lastFy}`}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="bg-raised">
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">funder</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">grants</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">total</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">years</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.funder_org_id} className="border-b border-border-1 last:border-0">
                  <td className="px-3.5 py-2">
                    <Link
                      href={`/org/${r.funder_org_id}`}
                      className="font-medium text-accent hover:text-accent-hover"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                    {countFull(r.n)}
                  </td>
                  <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                    {moneyFull(r.total)}
                  </td>
                  <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                    {r.first_fy && r.last_fy
                      ? r.first_fy === r.last_fy
                        ? `FY${r.first_fy}`
                        : `FY${r.first_fy}–${r.last_fy}`
                      : MDASH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

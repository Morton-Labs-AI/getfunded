import Link from "next/link";
import { AS_REPORTED_NOTE } from "@/lib/content/facts";
import { moneyFull, countFull, MDASH } from "@/lib/format";
import type { TopRecipientRow } from "@/lib/queries/org-profile";

/** Top recipients by total dollars. Resolved recipients link to their org
    page; unresolved ones render as-reported (dotted, never fake-linked). */
export function TopRecipients({ rows }: { rows: TopRecipientRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="bg-raised">
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">recipient</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">grants</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">total</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">fiscal years</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.recipient_org_id ?? r.display_name}
                  className="border-b border-border-1 last:border-0"
                >
                  <td className="max-w-[380px] px-3.5 py-2">
                    {r.recipient_org_id ? (
                      <Link
                        href={`/org/${r.recipient_org_id}`}
                        className="font-medium text-accent hover:text-accent-hover"
                      >
                        {r.display_name}
                      </Link>
                    ) : (
                      <span className="as-reported" title={AS_REPORTED_NOTE}>
                        {r.display_name}
                      </span>
                    )}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                    {countFull(r.n)}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                    {moneyFull(r.total)}
                  </td>
                  <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                    {r.first_fy
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
      <p className="mt-3 text-[11.5px] text-ink-4">
        Grouped by resolved organization where one exists, otherwise by exact
        reported name — spelling variants of the same recipient stay separate,
        never merged by guesswork.
      </p>
    </div>
  );
}

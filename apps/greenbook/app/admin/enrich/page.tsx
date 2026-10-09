import Link from "next/link";
import { enrichQueue } from "@/lib/admin/enrich-queue";

export const dynamic = "force-dynamic";

const fmtMoney = (v: string | null) =>
  v === null
    ? "—" // NULL is absent-from-return, never $0
    : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** The enrichment worklist: top grantmakers with a website candidate and no
    confirmed enrichment. Each row links into the existing per-org console —
    fetch, extract, preview, and the human confirm that actually publishes. */
export default async function EnrichQueuePage() {
  const rows = await enrichQueue(50);

  return (
    <div className="page-enter mx-auto w-full max-w-[980px] px-6 pb-16 pt-10">
      <span className="mono-label">website enrichment · queue · dev only</span>
      <h1 className="mt-2 text-[24px] font-[650] leading-8 tracking-[-0.02em] text-ink-1">
        Enrichment queue
      </h1>
      <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-ink-3">
        Grantmakers by latest-filing giving that have a website on record
        &mdash; filer-stated on the 990 itself where available &mdash; and no
        confirmed enrichment yet. The queue is not filtered by application
        posture: <em>unknown</em> is an absence of a statement, not a refusal.
      </p>
      <table className="mt-6 w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border-1 text-left text-[11px] uppercase tracking-[0.08em] text-ink-4">
            <th className="py-2 pr-3 font-[550]">#</th>
            <th className="py-2 pr-3 font-[550]">organization</th>
            <th className="py-2 pr-3 font-[550]">giving (latest FY)</th>
            <th className="py-2 pr-3 font-[550]">posture</th>
            <th className="py-2 pr-3 font-[550]">website</th>
            <th className="py-2 font-[550]">st</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-border-1/60 hover:bg-inset/50">
              <td className="py-2 pr-3 text-ink-4">{i + 1}</td>
              <td className="py-2 pr-3">
                <Link
                  href={`/admin/enrich/${r.id}`}
                  className="text-accent hover:text-accent-hover"
                >
                  {r.name}
                </Link>
                <span className="ml-2 text-[11px] text-ink-4">
                  {r.return_type === "990PF" ? "990-PF" : r.return_type} · FY{r.fy}
                </span>
              </td>
              <td className="py-2 pr-3 tabular-nums">{fmtMoney(r.giving)}</td>
              <td className="py-2 pr-3 text-ink-3">{r.application_posture ?? "unknown"}</td>
              <td className="py-2 pr-3 text-ink-3">{host(r.website)}</td>
              <td className="py-2 text-ink-4">{r.state ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-ink-4">
                Queue empty &mdash; either the website backfill has not run
                yet, or everything with a website is already enriched.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

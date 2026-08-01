import Link from "next/link";
import { countFull } from "@/lib/format";

/** Search + pagination controls for the foundation grants table. Zero-JS:
    a GET form (submitting resets to page 1) plus prev/next links that
    compose {from, q, page} back into the org URL. */
export function GrantsPager({
  orgId,
  from,
  q,
  page,
  pageCount,
  total,
}: {
  orgId: string;
  from?: string;
  q?: string;
  page: number;
  pageCount: number;
  total: number;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (from) sp.set("from", from);
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return `/org/${orgId}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <form method="get" action={`/org/${orgId}`} className="flex items-center gap-2">
        {from && <input type="hidden" name="from" value={from} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search recipient or purpose"
          className="h-9 w-[260px] rounded-[8px] border border-border-2 bg-raised px-3 text-[13px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
        />
        <button
          type="submit"
          className="h-9 rounded-[8px] border border-border-2 px-3 text-[12.5px] font-medium text-ink-2 transition-colors duration-[90ms] hover:bg-inset"
        >
          Search
        </button>
        {q && (
          <Link
            href={`/org/${orgId}${from ? `?from=${from}` : ""}`}
            className="text-[12.5px] text-accent hover:text-accent-hover"
          >
            clear
          </Link>
        )}
      </form>
      <div className="flex items-center gap-3">
        <span className="tnum font-mono text-[11.5px] text-ink-4">
          {`page ${page} of ${pageCount} · ${countFull(total)} grants`}
        </span>
        {page > 1 ? (
          <Link
            href={href(page - 1)}
            className="rounded-[8px] border border-border-2 px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-colors duration-[90ms] hover:bg-inset"
          >
            ← prev
          </Link>
        ) : (
          <span className="rounded-[8px] border border-border-1 px-2.5 py-1 text-[12.5px] text-ink-4">
            ← prev
          </span>
        )}
        {page < pageCount ? (
          <Link
            href={href(page + 1)}
            className="rounded-[8px] border border-border-2 px-2.5 py-1 text-[12.5px] font-medium text-ink-2 transition-colors duration-[90ms] hover:bg-inset"
          >
            next →
          </Link>
        ) : (
          <span className="rounded-[8px] border border-border-1 px-2.5 py-1 text-[12.5px] text-ink-4">
            next →
          </span>
        )}
      </div>
    </div>
  );
}

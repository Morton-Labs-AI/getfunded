import Link from "next/link";
import {
  browseOrgs,
  browseOrgsByThesis,
  parseBrowseFilters,
  segmentCounts,
  thesisCapable,
  type BrowseFilters,
} from "@/lib/queries/browse";
import { POSTURE_SCOPE_NOTE } from "@/lib/content/facts";
import { BrowseControls } from "@/components/browse-controls";
import { TrichotomyBadge } from "@/components/trichotomy-badge";
import { countCompact, moneyCompact, MDASH, ORG_TYPE_LABELS } from "@/lib/format";

const SEGMENTS = [
  { key: "foundations", label: "Foundations" },
  { key: "advisers", label: "VCs & Advisers" },
  { key: "funds", label: "Funds" },
  { key: "companies", label: "Companies" },
  { key: "agencies", label: "Agencies" },
] as const;

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // One allowlisting validator, shared with /api/filters so a model-authored
  // filter set goes through the same gate a hand-typed URL does.
  const { page: parsedPage, ...filters } = parseBrowseFilters(sp);
  const segment = filters.segment;

  // Thesis mode: RRF rank order over the semantic corpus, offset-paged
  // within a fixed candidate pool. Keyset cursors don't apply to rank order,
  // so thesis and cursor are mutually exclusive.
  const thesisMode = Boolean(filters.thesis) && thesisCapable(segment);
  const page = thesisMode ? parsedPage : 0;
  const [result, counts] = await Promise.all([
    thesisMode
      ? browseOrgsByThesis(filters as BrowseFilters & { thesis: string }, page)
      : browseOrgs(filters).then((rows) => ({
          rows,
          totalMatched: -1,
          fallback: false,
        })),
    segmentCounts(),
  ]);
  const rows = result.rows;
  const isFoundations = segment === "foundations";
  const isAdvisers = segment === "advisers";

  const qsWithout = (drop: string[]) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && !drop.includes(k)) next.set(k, v);
    }
    return next;
  };

  const cursorHref = (row: (typeof rows)[number], dir: "next" | "prev") => {
    const next = qsWithout(["cursor", "dir"]);
    next.set("cursor", `${row.name_normalized}~~${row.id}`);
    next.set("dir", dir);
    return `/browse?${next.toString()}`;
  };

  return (
    <div className="page-enter mx-auto w-full max-w-[1440px] px-6 pb-16 pt-8">
      {/* segmented control */}
      <div className="flex flex-wrap gap-1 border-b border-border-1">
        {SEGMENTS.map((s) => {
          // posture/mindist/basis are foundations-only facets.
          const next = qsWithout(["cursor", "dir", "page", "ntee", "era",
                                  "fundType", "posture", "mindist", "basis", "segment"]);
          next.set("segment", s.key);
          const active = s.key === segment;
          return (
            <Link
              key={s.key}
              href={`/browse?${next.toString()}`}
              className={`relative -mb-px flex items-center gap-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors duration-[90ms] ${
                active ? "text-ink-1" : "text-ink-3 hover:text-ink-1"
              }`}
            >
              {s.label}
              <span className="tnum font-mono text-[10.5px] text-ink-4">
                {countCompact(counts[s.key])}
              </span>
              {active && (
                <span className="absolute inset-x-3.5 bottom-0 h-[2px] bg-accent" />
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-5">
        <BrowseControls segment={segment} />
      </div>

      {sp.thesis && !thesisCapable(segment) && (
        <p className="mt-3 text-[12.5px] text-ink-4">
          Thesis matching isn&apos;t available for this segment (no giving-behavior
          corpus) — showing the standard listing.
        </p>
      )}
      {thesisMode && result.fallback && (
        <p className="mt-3 text-[12.5px] text-ink-4">
          Semantic search unavailable — matched &ldquo;{sp.thesis}&rdquo; as keywords instead.
        </p>
      )}

      {/* results */}
      <div className="mt-5 overflow-hidden rounded-[10px] border border-border-1 bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="bg-raised">
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">name</th>
                <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">location</th>
                {isFoundations && (
                  <>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">assets</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">ntee</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">grants on file</th>
                  </>
                )}
                {isAdvisers && (
                  <>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">aum / fund assets</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">reg.</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>
                  </>
                )}
                {segment === "funds" && (
                  <>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">gross assets</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>
                  </>
                )}
                {(segment === "companies" || segment === "agencies") && (
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-1 last:border-0 hover:bg-raised">
                  <td className="px-3.5 py-2.5">
                    <Link href={`/org/${r.id}`} className="font-medium text-ink-1 hover:text-accent">
                      {r.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-ink-3">
                    {[r.city, r.state].filter(Boolean).join(", ") || MDASH}
                  </td>
                  {isFoundations && (
                    <>
                      <td className="tnum whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[12.5px] text-ink-1">
                        {r.asset_amount ? moneyCompact(r.asset_amount) : MDASH}
                      </td>
                      <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[11.5px] text-ink-3">
                        {r.ntee_code ?? MDASH}
                      </td>
                      <td className="tnum whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[12.5px]">
                        {r.grants_n ? (
                          <span className="text-ink-1">
                            {r.grants_n}
                            <span className="text-ink-4"> · {moneyCompact(r.grants_total)}</span>
                          </span>
                        ) : (
                          <span className="text-ink-4">{MDASH}</span>
                        )}
                      </td>
                    </>
                  )}
                  {isAdvisers && (
                    <>
                      <td className="tnum whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[12.5px] text-ink-1">
                        {r.aum || r.fund_size ? moneyCompact(r.aum ?? r.fund_size) : MDASH}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[11.5px] text-ink-3">
                        {r.is_era ? "ERA" : "RIA"}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <TrichotomyBadge orgType={r.org_type} label={ORG_TYPE_LABELS[r.org_type]} />
                      </td>
                    </>
                  )}
                  {segment === "funds" && (
                    <>
                      <td className="tnum whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[12.5px] text-ink-1">
                        {r.fund_size ? moneyCompact(r.fund_size) : MDASH}
                      </td>
                      <td className="px-3.5 py-2.5 text-ink-3">{r.focus_areas[0] ?? MDASH}</td>
                    </>
                  )}
                  {(segment === "companies" || segment === "agencies") && (
                    <td className="px-3.5 py-2.5">
                      <TrichotomyBadge orgType={r.org_type} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3.5 py-10 text-center text-[13.5px] text-ink-3">
                    No {segment} match these filters.{" "}
                    {(filters.posture || filters.minDist) && (
                      <span className="block pb-2">{POSTURE_SCOPE_NOTE}</span>
                    )}
                    Keyword search matches names and locations, not grant text —{" "}
                    <Link
                      href={`/?q=${encodeURIComponent(`Find ${segment} matching: ${sp.q ?? ""} ${sp.state ?? ""}`)}`}
                      className="text-accent hover:text-accent-hover"
                    >
                      ask the analyst instead
                    </Link>
                    .
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-border-1 px-3.5 py-2">
            <span className="tnum font-mono text-[11px] text-ink-3">
              {thesisMode && !result.fallback
                ? `rank-ordered · ${result.totalMatched} thesis matches in the candidate pool`
                : `${rows.length} per page · keyset-paginated`}
            </span>
            <div className="flex gap-2">
              {thesisMode && !result.fallback ? (
                <>
                  {page > 0 && (
                    <Link
                      href={`/browse?${(() => { const n = qsWithout(["page"]); n.set("page", String(page - 1)); return n.toString(); })()}`}
                      className="rounded-[8px] border border-border-1 px-3 py-1 text-[12.5px] text-ink-2 hover:border-border-2"
                    >
                      ← Prev
                    </Link>
                  )}
                  {(page + 1) * 50 < result.totalMatched && (
                    <Link
                      href={`/browse?${(() => { const n = qsWithout(["page"]); n.set("page", String(page + 1)); return n.toString(); })()}`}
                      className="rounded-[8px] border border-border-1 px-3 py-1 text-[12.5px] text-ink-2 hover:border-border-2"
                    >
                      Next →
                    </Link>
                  )}
                </>
              ) : (
                <>
                  {sp.cursor && (
                    <Link
                      href={cursorHref(rows[0], "prev")}
                      className="rounded-[8px] border border-border-1 px-3 py-1 text-[12.5px] text-ink-2 hover:border-border-2"
                    >
                      ← Prev
                    </Link>
                  )}
                  {rows.length === 50 && (
                    <Link
                      href={cursorHref(rows[rows.length - 1], "next")}
                      className="rounded-[8px] border border-border-1 px-3 py-1 text-[12.5px] text-ink-2 hover:border-border-2"
                    >
                      Next →
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

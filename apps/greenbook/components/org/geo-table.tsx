import { moneyFull, countFull } from "@/lib/format";
import type { GeoRow } from "@/lib/queries/org-profile";

const TOP = 8;

/** Grant dollars by recipient state — top 8 rows + an 'other' rollup, with
    proportional inline bars (server-rendered, zero JS). */
export function GeoTable({ rows }: { rows: GeoRow[] }) {
  if (rows.length === 0) return null;
  const top = rows.slice(0, TOP);
  const rest = rows.slice(TOP);
  const restN = rest.reduce((s, r) => s + Number(r.n), 0);
  const restTotal = rest.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const max = Math.max(...top.map((r) => Number(r.total ?? 0)), 1);

  return (
    <div>
      <div className="flex flex-col gap-1.5">
        {top.map((r) => (
          <GeoBar
            key={r.state}
            label={r.state === "??" ? "unknown" : r.state}
            n={r.n}
            total={r.total}
            pct={(Number(r.total ?? 0) / max) * 100}
          />
        ))}
        {rest.length > 0 && (
          <GeoBar
            label={`other (${rest.length})`}
            n={restN}
            total={String(restTotal)}
            pct={(restTotal / max) * 100}
          />
        )}
      </div>
      <p className="mt-3 text-[11.5px] text-ink-4">
        Recipient state as reported in the filing.
      </p>
    </div>
  );
}

function GeoBar({
  label,
  n,
  total,
  pct,
}: {
  label: string;
  n: number | string;
  total: string | null;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="mono-label w-[72px] shrink-0 normal-case tracking-[0.04em]">
        {label}
      </span>
      <div className="h-[14px] flex-1 overflow-hidden rounded-[3px] bg-inset">
        <div
          className="h-full rounded-[3px]"
          style={{
            width: `${Math.max(pct, 0.75)}%`,
            background: "var(--cat-grant-fill)",
          }}
        />
      </div>
      <span className="tnum w-[104px] shrink-0 text-right font-mono text-[12.5px] text-ink-1">
        {moneyFull(total)}
      </span>
      <span className="tnum w-[86px] shrink-0 text-right font-mono text-[11.5px] text-ink-4">
        {`${countFull(n)} grants`}
      </span>
    </div>
  );
}

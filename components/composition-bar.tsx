import { countCompact, eventCategory, EVENT_TYPE_LABELS } from "@/lib/format";
import type { EventTypeTotal } from "@/lib/queries/stats";

const CAT_FILL: Record<string, string> = {
  equity: "var(--cat-equity-fill)",
  grant: "var(--cat-grant-fill)",
  federal: "var(--cat-federal-fill)",
};
const CAT_TEXT: Record<string, string> = {
  equity: "var(--cat-equity)",
  grant: "var(--cat-grant)",
  federal: "var(--cat-federal)",
};

/** One stacked band: what the 2.6M events actually are. 2px surface gaps
 *  between fills (dataviz mark spec); labels never wear series color alone. */
export function CompositionBar({ data }: { data: EventTypeTotal[] }) {
  const byCat = new Map<string, { n: number; types: string[] }>();
  for (const row of data) {
    const cat = eventCategory(row.event_type) ?? "equity";
    const cur = byCat.get(cat) ?? { n: 0, types: [] };
    cur.n += Number(row.n);
    cur.types.push(row.event_type);
    byCat.set(cat, cur);
  }
  const order = ["grant", "federal", "equity"] as const;
  const total = [...byCat.values()].reduce((s, v) => s + v.n, 0);
  if (!total) return null;

  return (
    <div className="w-full max-w-[720px]">
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
        {order.map((cat) => {
          const seg = byCat.get(cat);
          if (!seg) return null;
          return (
            <div
              key={cat}
              style={{
                width: `${(seg.n / total) * 100}%`,
                background: CAT_FILL[cat],
                minWidth: 6,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap justify-center gap-x-6 gap-y-1">
        {order.map((cat) => {
          const seg = byCat.get(cat);
          if (!seg) return null;
          const label =
            cat === "grant"
              ? "foundation grants"
              : cat === "federal"
                ? "SBIR / STTR awards"
                : "Reg D offerings";
          return (
            <span key={cat} className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
              <span
                className="inline-block h-2 w-2 rounded-[2px]"
                style={{ background: CAT_FILL[cat] }}
              />
              <span className="tnum font-medium" style={{ color: CAT_TEXT[cat] }}>
                {countCompact(seg.n)}
              </span>
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

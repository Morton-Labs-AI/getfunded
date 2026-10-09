import { SourceGlyph } from "@/components/source-glyph";
import { SIGNALS_NOTE } from "@/lib/content/facts";
import type { SignalRow } from "@/lib/queries/signals";
import { moneyCompact } from "@/lib/format";

const TYPE_LABELS: Record<string, string> = {
  capital_commitment: "new capital commitment",
  program_launch: "new program",
  rfp_open: "open call",
  deadline: "deadline",
  grant_announced: "grants announced",
  investment_announced: "investment announced",
  fund_close: "fund closed",
  strategy_shift: "strategy change",
  leadership_change: "leadership change",
  partnership: "partnership",
  event: "event",
  other: "announcement",
};
const RECIPIENTS: Record<string, string> = {
  nonprofit: "nonprofits", for_profit: "for-profit companies", fund: "funds", government: "government",
  academic: "universities & labs", individual: "individuals", unspecified: "not specified",
};
const INSTRUMENTS: Record<string, string> = {
  grant: "grants", pri: "program-related investments", mri: "mission-related investments", equity: "equity",
  debt: "loans", guarantee: "guarantees", prize: "prizes", contract: "contracts",
  technical_assistance: "technical assistance", unspecified: "not specified",
};

function Chips({ items, map }: { items: string[]; map?: Record<string, string> }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span key={s} className="rounded-full border border-border-1 bg-raised px-2.5 py-0.5 text-[12px] text-ink-2">
          {map?.[s] ?? s.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

/** "Signals" — the funder's own announcements. Facts (date, type, amount,
    chips) are the page's statements with a seal to our compilation file; the
    paragraph is the classifier's paraphrase and says so. */
export function Signals({ rows }: { rows: SignalRow[] }) {
  return (
    <div className="flex flex-col gap-6">
      {rows.map((s) => {
        const prov = {
          dataset: s.dataset_name,
          sourceUrl: s.url,
          sha256: s.sha256,
          license: s.license_name,
          locator: s.source_record_locator,
          ingested: s.discovered_at,
        };
        return (
          <article key={s.id} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <SourceGlyph prov={prov}>
                <span className="mono-label">{s.published_at ?? "date not stated"}</span>
              </SourceGlyph>
              <span className="mono-label rounded-full border border-border-2 px-2 py-px">
                {TYPE_LABELS[s.signal_type ?? "other"] ?? s.signal_type}
              </span>
              {s.amount_usd && (
                <span className="tnum text-[12.5px] text-ink-2">
                  {moneyCompact(s.amount_usd)}
                  {s.horizon_end ? ` through ${s.horizon_end.slice(0, 4)}` : ""}
                </span>
              )}
            </div>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-[720px] text-[15px] font-semibold leading-snug text-ink-1 underline decoration-dotted decoration-border-2 underline-offset-4 hover:decoration-accent"
            >
              {s.headline ?? s.url}
            </a>
            {s.summary && (
              <p className="max-w-[720px] text-[13.5px] leading-relaxed text-ink-2">
                <span className="mono-label mr-2 text-[10px]">classifier paraphrase</span>
                {s.summary}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {s.eligible_recipients.length > 0 && (
                <div>
                  <div className="mono-label mb-1">who can receive</div>
                  <Chips items={s.eligible_recipients} map={RECIPIENTS} />
                </div>
              )}
              {s.instruments.length > 0 && (
                <div>
                  <div className="mono-label mb-1">how</div>
                  <Chips items={s.instruments} map={INSTRUMENTS} />
                </div>
              )}
              {s.sectors.length > 0 && (
                <div>
                  <div className="mono-label mb-1">fields</div>
                  <Chips items={s.sectors} />
                </div>
              )}
            </div>
          </article>
        );
      })}
      <p className="max-w-[720px] text-[11.5px] leading-relaxed text-ink-4">{SIGNALS_NOTE}</p>
    </div>
  );
}

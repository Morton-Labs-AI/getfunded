import Link from "next/link";
import { SourceGlyph } from "./source-glyph";
import { TrichotomyBadge } from "./trichotomy-badge";
import { AS_REPORTED_NOTE } from "@/lib/content/facts";
import { moneyFull, MDASH, EVENT_TYPE_LABELS } from "@/lib/format";
import type { EventRow } from "@/lib/queries/orgs";

export function EventsTable({
  rows,
  prov,
  showType,
  received,
}: {
  rows: EventRow[];
  prov: Parameters<typeof SourceGlyph>[0]["prov"];
  showType?: boolean;
  received?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-raised">
              {showType && <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>}
              {!received && <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">recipient</th>}
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">
                {received ? "detail" : "purpose"}
              </th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">amount</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">fy / date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              // Per-row file provenance when the query supplies it (grant rows
              // come from per-FY 990 e-files, not the org's BMF row); page-level
              // prov otherwise.
              const rowProv =
                e.dataset_name && e.sha256 && e.license_name
                  ? {
                      dataset: e.dataset_name,
                      sourceUrl: e.source_url ?? null,
                      sha256: e.sha256,
                      license: e.license_name,
                      locator: e.source_record_locator,
                      ingested: e.downloaded_at ?? null,
                    }
                  : { ...prov, locator: e.source_record_locator };
              return (
              <tr key={e.id} className="border-b border-border-1 last:border-0 align-top">
                {showType && (
                  <td className="whitespace-nowrap px-3.5 py-2">
                    <TrichotomyBadge eventType={e.event_type} label={EVENT_TYPE_LABELS[e.event_type]} />
                  </td>
                )}
                {!received && (
                  <td className="max-w-[260px] px-3.5 py-2 text-ink-2">
                    {e.recipient_org_id ? (
                      <Link
                        href={`/org/${e.recipient_org_id}`}
                        className="font-medium text-accent hover:text-accent-hover"
                      >
                        {e.recipient_name}
                      </Link>
                    ) : (
                      <span className="as-reported" title={AS_REPORTED_NOTE}>
                        {e.recipient_name}
                      </span>
                    )}
                    {(e.recipient_city || e.recipient_state) && (
                      <span className="text-ink-4">
                        {" "}
                        · {[e.recipient_city, e.recipient_state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </td>
                )}
                <td className="max-w-[380px] px-3.5 py-2 text-ink-3">
                  {e.purpose_text ? (
                    <span title={e.purpose_text.length > 90 ? e.purpose_text : undefined}>
                      {e.purpose_text.slice(0, 90)}
                      {e.purpose_text.length > 90 ? "…" : ""}
                    </span>
                  ) : (
                    MDASH
                  )}
                </td>
                <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                  <SourceGlyph prov={rowProv}>
                    {e.amount ? moneyFull(e.amount) : MDASH}
                  </SourceGlyph>
                </td>
                <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                  {e.fiscal_year ?? e.event_date ?? MDASH}
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

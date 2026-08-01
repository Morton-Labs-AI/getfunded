import { SourceGlyph } from "@/components/source-glyph";
import { WEB_FACTS_NOTE } from "@/lib/content/facts";
import type { OrgWebFactsRow, WebFactsPerson } from "@/lib/queries/org-profile";

const ROLE_ORDER: WebFactsPerson["role"][] = [
  "program_officer",
  "executive",
  "staff",
  "board",
];
const ROLE_LABELS: Record<string, string> = {
  program_officer: "program officers",
  executive: "executives",
  staff: "staff",
  board: "board",
};

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span
          key={s}
          className="rounded-full border border-border-1 bg-raised px-2.5 py-0.5 text-[12px] text-ink-2"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

/** "From the foundation's website" — the enriched-facts block. Every value is
    model-extracted from the site snapshot and human-confirmed; the seal traces
    to the snapshot raw_file, and the internal badge marks it as never
    filing-sourced and never republished. */
export function WebFacts({ wf }: { wf: OrgWebFactsRow }) {
  const prov = {
    dataset: wf.dataset_name,
    sourceUrl: wf.source_url,
    sha256: wf.sha256,
    license: wf.license_name,
    locator: wf.source_record_locator,
    ingested: wf.downloaded_at,
  };
  const people = (wf.people ?? []) as WebFactsPerson[];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SourceGlyph prov={prov}>
          <span className="mono-label">
            retrieved {wf.downloaded_at?.slice(0, 10) ?? "—"}
          </span>
        </SourceGlyph>
        <span
          className="mono-label rounded-full border border-border-2 px-2 py-px"
          title={WEB_FACTS_NOTE}
        >
          internal
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {wf.extracted_summary && (
          <p className="max-w-[720px] text-[13.5px] leading-relaxed text-ink-2">
            {wf.extracted_summary}
          </p>
        )}

        {wf.focus_areas.length > 0 && (
          <div>
            <div className="mono-label mb-1.5">focus areas</div>
            <Chips items={wf.focus_areas} />
          </div>
        )}

        {wf.geographic_focus.length > 0 && (
          <div>
            <div className="mono-label mb-1.5">geographic focus</div>
            <Chips items={wf.geographic_focus} />
          </div>
        )}

        {wf.giving_priorities && (
          <div>
            <div className="mono-label mb-1">giving priorities</div>
            <p className="max-w-[720px] text-[13px] leading-relaxed text-ink-2">
              {wf.giving_priorities}
            </p>
          </div>
        )}

        {(wf.application_info || wf.application_url || wf.accepts_unsolicited !== null) && (
          <div>
            <div className="mono-label mb-1 flex items-center gap-2">
              applying
              {wf.accepts_unsolicited !== null && (
                <span className="rounded-full border border-border-1 px-2 py-px text-[10.5px] normal-case tracking-normal text-ink-3">
                  {wf.accepts_unsolicited
                    ? "accepts unsolicited proposals"
                    : "does not accept unsolicited proposals"}
                </span>
              )}
            </div>
            {wf.application_info && (
              <p className="max-w-[720px] text-[13px] leading-relaxed text-ink-2">
                {wf.application_info}
              </p>
            )}
            {wf.application_url && (
              <a
                href={wf.application_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[12.5px] text-accent underline decoration-dotted"
              >
                how to apply ↗
              </a>
            )}
          </div>
        )}

        {people.length > 0 && (
          <div>
            <div className="mono-label mb-1.5">people listed on the site</div>
            {ROLE_ORDER.filter((r) => people.some((p) => p.role === r)).map((role) => (
              <div key={role} className="mb-1.5">
                <span className="mono-label mr-2 text-[10px]">{ROLE_LABELS[role]}</span>
                <span className="text-[13px] text-ink-1">
                  {people
                    .filter((p) => p.role === role)
                    .map((p) => (p.title ? `${p.full_name} (${p.title})` : p.full_name))
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-4 max-w-[720px] text-[11.5px] leading-relaxed text-ink-4">
        {WEB_FACTS_NOTE}
      </p>
    </div>
  );
}

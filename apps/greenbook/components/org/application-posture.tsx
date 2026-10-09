import { SourceGlyph } from "@/components/source-glyph";
import {
  APPLICATION_POSTURE_NOTE,
  POSTURE_UNSTATED_NOTE,
  PART_XV_FREE_TEXT_NOTE,
  CONTACT_TIER_NOTE,
} from "@/lib/content/facts";
import { dateShort, MDASH } from "@/lib/format";
import type { ContactRow, PostureRow } from "@/lib/queries/contacts";

const BADGE: Record<
  PostureRow["application_posture"],
  { label: string; bg: string; color: string; title: string }
> = {
  open: {
    label: "open to applications",
    bg: "var(--accent-tint)",
    color: "var(--accent)",
    title: APPLICATION_POSTURE_NOTE,
  },
  preselected_only: {
    label: "preselected only",
    bg: "color-mix(in srgb, var(--caution) 12%, transparent)",
    color: "var(--caution)",
    title:
      "The foundation reports it contributes only to preselected " +
      "organizations and does not accept unsolicited requests for funds.",
  },
  // Deliberately neutral, and the word "closed" appears nowhere: this is an
  // absence of a statement, not a refusal.
  unknown: {
    label: "not stated on this return",
    bg: "var(--bg-inset)",
    color: "var(--ink-3)",
    title: POSTURE_UNSTATED_NOTE,
  },
};

/** Applying: posture, the as-filed Part XV strings, and tiered contacts. */
export function ApplicationPosture({
  posture,
  contacts,
}: {
  posture: PostureRow;
  contacts: ContactRow[];
}) {
  const b = BADGE[posture.application_posture];
  const prov = {
    dataset: posture.dataset_name,
    sourceUrl: posture.source_url,
    sha256: posture.sha256,
    license: posture.license_name,
    locator: posture.object_id,
    ingested: posture.downloaded_at,
  };
  const publicContacts = contacts.filter((c) => c.is_public);
  const internalContacts = contacts.filter((c) => !c.is_public);
  const strings: [string, string | null][] = [
    ["materials", posture.form_and_info_txt],
    ["deadlines", posture.submission_deadlines_txt],
    ["restrictions", posture.restrictions_txt],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="rounded-[5px] px-2.5 py-[4px] font-mono text-[11px] uppercase tracking-[0.08em]"
          style={{ background: b.bg, color: b.color }}
          title={b.title}
        >
          {b.label}
        </span>
        <SourceGlyph prov={prov}>
          <span className="text-[12.5px] text-ink-3">
            {`as of FY${posture.fy ?? "?"} · Form 990-PF Part XV`}
          </span>
        </SourceGlyph>
      </div>

      {strings.some(([, v]) => v) && (
        <div className="flex flex-col gap-2 text-[13.5px] text-ink-2">
          {strings.map(([label, v]) =>
            v ? (
              <div key={label}>
                <span className="mono-label mr-2">{label}</span>
                <span className="as-reported" title={PART_XV_FREE_TEXT_NOTE}>
                  {v}
                </span>
              </div>
            ) : null
          )}
        </div>
      )}

      {posture.contact_name && (
        <div className="text-[13.5px] text-ink-2">
          {/* NOT labelled as a person: filers routinely put whole sentences in
              the RecipientPersonNm element (Topfer's reads "PLEASE VISIT THE
              WEBSITE AT TOPFERF"). */}
          <span className="mono-label mr-2">as reported on the return</span>
          <span className="as-reported" title={PART_XV_FREE_TEXT_NOTE}>
            {posture.contact_name}
          </span>
          {(posture.app_city || posture.app_state) && (
            <span className="text-ink-4">
              {` · ${[posture.app_city, posture.app_state].filter(Boolean).join(", ")}`}
            </span>
          )}
        </div>
      )}

      {(publicContacts.length > 0 || internalContacts.length > 0) && (
        <div className="flex flex-col gap-1.5">
          {publicContacts.map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-[13.5px]">
              <span className="mono-label w-[54px] shrink-0">{c.channel_type}</span>
              <SourceGlyph
                prov={{
                  dataset: c.dataset_name ?? "irs_990_xml",
                  sourceUrl: c.source_url,
                  sha256: c.sha256 ?? "",
                  license: c.license_name ?? "",
                  locator: c.source_record_locator,
                  ingested: c.downloaded_at,
                }}
              >
                <a
                  href={
                    c.channel_type === "email"
                      ? `mailto:${c.value}`
                      : `tel:${c.value}`
                  }
                  className="text-accent hover:text-accent-hover"
                >
                  {c.value}
                </a>
              </SourceGlyph>
              {c.is_role_based && (
                <span className="rounded-[4px] bg-inset px-1.5 py-[2px] font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
                  role inbox
                </span>
              )}
            </div>
          ))}
          {internalContacts.map((c) => (
            // No value, no domain, no local part — the projection never sent
            // one. Shown so the absence is legible rather than invisible.
            <div
              key={c.id}
              className="flex items-center gap-2 text-[13.5px] text-ink-4"
              title={CONTACT_TIER_NOTE}
            >
              <span className="mono-label w-[54px] shrink-0">{c.channel_type}</span>
              <span>{MDASH}</span>
              <span className="rounded-[4px] bg-inset px-1.5 py-[2px] font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
                internal — not published
              </span>
              {c.last_verified_at && (
                <span className="text-[11.5px]">
                  {`on the ${dateShort(c.last_verified_at)} return`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11.5px] text-ink-4">
        {posture.application_posture === "unknown"
          ? POSTURE_UNSTATED_NOTE
          : APPLICATION_POSTURE_NOTE}
        {contacts.length > 0 ? ` ${CONTACT_TIER_NOTE}` : ""}
      </p>
    </div>
  );
}

import { Missing } from "@/components/data/missing";
import { Posture, POSTURE_LABELS } from "@/components/data/posture";
import { SourceValue } from "@/components/data/source-chip";
import {
  CAN_I_APPLY_TITLE,
  CONTACT_NAME_WITHHELD,
  CONTACT_NAME_WITHHELD_NOTE,
  CONTACT_ON_FILE_NOT_PUBLISHED,
  HOW_TO_APPLY_NOTE,
  PART_XV_FREE_TEXT_NOTE,
  POSTURE_EXPLAINERS,
} from "@/lib/content/copy";
import type { FunderRecord } from "@/lib/queries/corpus/types";

import { ProfileSection } from "./profile-section";
import { Seal } from "./provenance";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow mb-1 text-muted-foreground">{label}</dt>
      <dd className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{children}</dd>
    </div>
  );
}

/** "Can I apply?" from Part XV of the latest 990-PF, as filed. */
export function ApplySection({ funder }: { funder: FunderRecord }) {
  const app = funder.application;
  const posture = funder.posture ?? "unknown";

  if (!app) {
    return (
      <ProfileSection id="apply" title={CAN_I_APPLY_TITLE} aside={<Posture value="unknown" />} note={POSTURE_EXPLAINERS.unknown}>
        <p className="text-sm text-ink-2">
          {funder.orgType === "public_charity"
            ? "This organization files Form 990, which has no section for application policy. Its filings cannot say either way."
            : "No parsed Form 990-PF with a Part XV statement is on record for this funder."}
        </p>
      </ProfileSection>
    );
  }

  const hasGuidance = Boolean(app.howToApply || app.deadlines || app.restrictions || app.contactName || app.contactNameWithheld);
  const seal = <Seal p={app.provenance} />;

  return (
    <ProfileSection
      id="apply"
      title={CAN_I_APPLY_TITLE}
      aside={<Posture value={posture} />}
      note={
        <>
          {HOW_TO_APPLY_NOTE} {PART_XV_FREE_TEXT_NOTE}
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">{POSTURE_EXPLAINERS[posture]}</p>

      {hasGuidance ? (
        <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {app.howToApply ? (
            <Field label="How to apply">
              <SourceValue label="How to apply, as filed" provenance={seal}>
                {app.howToApply}
              </SourceValue>
            </Field>
          ) : null}
          {app.deadlines ? (
            <Field label="Deadlines">
              <SourceValue label="Deadlines, as filed" provenance={seal}>
                {app.deadlines}
              </SourceValue>
            </Field>
          ) : null}
          {app.restrictions ? (
            <Field label="Restrictions">
              <SourceValue label="Restrictions, as filed" provenance={seal}>
                {app.restrictions}
              </SourceValue>
            </Field>
          ) : null}
          {app.contactName || app.contactNameWithheld ? (
            <Field label="Send applications to">
              {app.contactName ? (
                <SourceValue label="Application contact, as filed" provenance={seal}>
                  {app.contactName}
                </SourceValue>
              ) : (
                <span className="text-ink-3" title={CONTACT_NAME_WITHHELD_NOTE}>
                  {CONTACT_NAME_WITHHELD}
                </span>
              )}
              {app.contactLocation ? <span className="block text-xs text-ink-3">{app.contactLocation}</span> : null}
              {app.contactNameWithheld ? <span className="mt-1 block text-xs text-ink-3">{CONTACT_NAME_WITHHELD_NOTE}</span> : null}
              {app.hasEmail || app.hasPhone ? (
                <span className="mt-1 block text-xs text-ink-3">
                  {[app.hasEmail ? "An email address" : null, app.hasPhone ? "a phone number" : null].filter(Boolean).join(" and ")} for
                  applications is on the filing. {CONTACT_ON_FILE_NOT_PUBLISHED}; see “How to reach them” for any published channel.
                </span>
              ) : null}
            </Field>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm">
          <Missing kind="no-public-data" /> <span className="text-ink-3">The return states a posture but gives no instructions.</span>
        </p>
      )}

      <p className="mt-3 text-xs text-ink-3">
        Application policy: {POSTURE_LABELS[posture]}
        {app.fy ? `, as stated on the FY${app.fy} return.` : ", as stated on the return."}
      </p>
    </ProfileSection>
  );
}

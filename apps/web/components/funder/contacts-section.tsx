import { Mail, Phone } from "lucide-react";

import { Missing } from "@/components/data/missing";
import { SourceValue } from "@/components/data/source-chip";
import { Badge } from "@/components/ui/badge";
import { CONTACT_TIER_NOTE } from "@/lib/content/copy";
import { datasetLabel } from "@/lib/content/labels";
import { formatDate } from "@/lib/format";
import type { ApplicationInfo, ContactChannel } from "@/lib/queries/corpus/types";

import { ProfileSection } from "./profile-section";
import { Seal } from "./provenance";

function hrefFor(c: ContactChannel): string | null {
  if (c.channelType === "email") return `mailto:${c.value}`;
  if (c.channelType === "phone") return `tel:${c.value.replace(/[^\d+]/g, "")}`;
  return null;
}

/** Public contact channels only. Values arrive from public.contact_channels. */
export function ContactsSection({ channels, application }: { channels: ContactChannel[]; application: ApplicationInfo | null }) {
  const hasEmailPublic = channels.some((c) => c.channelType === "email");
  const hasPhonePublic = channels.some((c) => c.channelType === "phone");
  const withheld = [
    application?.hasEmail && !hasEmailPublic ? "an email address" : null,
    application?.hasPhone && !hasPhonePublic ? "a phone number" : null,
  ].filter((s): s is string => Boolean(s));

  return (
    <ProfileSection id="contacts" title="How to reach them" note={CONTACT_TIER_NOTE}>
      {channels.length === 0 ? (
        <p className="text-sm">
          <Missing kind="no-public-data" />
        </p>
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => {
            const href = hrefFor(c);
            const Icon = c.channelType === "email" ? Mail : Phone;
            const seal = (
              <Seal
                p={{
                  source: datasetLabel(c.sourceDataset, "IRS 990 e-file"),
                  filingYear: null,
                  objectId: null,
                  sha256: null,
                  href: c.sourceUrl,
                  license: null,
                }}
              />
            );
            return (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
                  <SourceValue label={`${c.channelType} from a public filing`} provenance={seal}>
                    {href ? (
                      <a href={href} className="break-all text-primary hover:underline">
                        {c.value}
                      </a>
                    ) : (
                      c.value
                    )}
                  </SourceValue>
                </span>
                <span className="inline-flex items-center gap-2 text-xs text-ink-3">
                  {c.isRoleBased ? <Badge variant="source">Shared inbox</Badge> : null}
                  {c.lastVerifiedAt ? <span>on the {formatDate(c.lastVerifiedAt)} return</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {withheld.length > 0 ? (
        <p className="mt-3 text-xs text-ink-3">
          The latest Form 990-PF lists {withheld.join(" and ")} for applications. It is on the filing but not published here.
        </p>
      ) : null}
    </ProfileSection>
  );
}

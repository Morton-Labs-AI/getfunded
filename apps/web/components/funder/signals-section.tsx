import { ArrowUpRight } from "lucide-react";

import { AiBadge } from "@/components/data/ai-badge";
import { ProvenanceSeal } from "@/components/data/provenance-seal";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoneyCompact } from "@/lib/format";
import type { FunderSignal } from "@/lib/queries/corpus/signals";
import {
  ACTIONABLE_TYPES,
  INSTRUMENT_LABELS,
  RECIPIENT_LABELS,
  SECTOR_LABELS,
  SIGNAL_AI_REASON,
  SIGNALS_NOTE,
  labelList,
  signalTypeLabel,
} from "@/lib/signals/labels";

import { ProfileSection } from "./profile-section";

/**
 * "Signals": the funder's own dated announcements, newest first. Renders
 * nothing when there are none, so a page without signals looks exactly as it
 * did before this section existed.
 *
 * Two classes on one row, never blurred: the headline, date, link, amount
 * and chips are Source facts (the page said so; the seal names our
 * compilation file). The one-paragraph summary is the model's paraphrase and
 * carries the AI badge with its reason.
 */
export function SignalsSection({ signals }: { signals: FunderSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <ProfileSection
      id="signals"
      title="Signals"
      aside={
        <Badge variant="source" title="From the funder's own announcements">
          {signals.length} {signals.length === 1 ? "announcement" : "announcements"}
        </Badge>
      }
      note={SIGNALS_NOTE}
    >
      <ol className="flex flex-col divide-y divide-border/70">
        {signals.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className="tnum">{s.publishedAt ? formatDate(s.publishedAt) : "Date not stated"}</span>
              <span aria-hidden>·</span>
              <Badge variant={ACTIONABLE_TYPES.has(s.signalType ?? "") ? "warning" : "secondary"}>{signalTypeLabel(s.signalType)}</Badge>
              {s.amountUsd !== null ? (
                <Badge variant="outline" className="tnum">
                  {formatMoneyCompact(s.amountUsd)}
                  {s.horizonEnd ? ` through ${formatDate(s.horizonEnd, "year")}` : ""}
                </Badge>
              ) : null}
            </div>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-start gap-1 text-[15px] font-medium leading-snug text-foreground underline-offset-4 hover:underline"
            >
              {s.headline ?? s.url}
              <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
            </a>
            {s.summary ? (
              <div className="data-ai flex flex-col gap-1.5 px-3 py-2">
                <AiBadge reason={SIGNAL_AI_REASON} />
                <p className="text-sm leading-relaxed text-foreground">{s.summary}</p>
                {s.actionHint ? <p className="text-xs text-ink-2">{s.actionHint}</p> : null}
              </div>
            ) : null}
            <ChipRow label="Who can receive" values={labelList(s.eligibleRecipients, RECIPIENT_LABELS)} />
            <ChipRow label="How" values={labelList(s.instruments, INSTRUMENT_LABELS)} />
            <ChipRow label="Fields" values={labelList(s.sectors, SECTOR_LABELS)} />
            {s.geographies.length > 0 ? <ChipRow label="Where" values={s.geographies} /> : null}
            <ProvenanceSeal
              source={s.publisher ? `${s.publisher} announcement` : "Funder announcement"}
              filingYear={s.publishedAt ? s.publishedAt.slice(0, 4) : null}
              sha256={s.sha256}
              href={s.url}
              license={s.licenseName}
              retrievedAt={s.discoveredAt}
              className="self-start"
            />
          </li>
        ))}
      </ol>
    </ProfileSection>
  );
}

function ChipRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-ink-3">{label}:</span>
      {values.map((v) => (
        <Badge key={v} variant="source">
          {v}
        </Badge>
      ))}
    </div>
  );
}

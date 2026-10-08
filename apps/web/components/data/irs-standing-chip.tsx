import { ArrowUpRight, CircleHelp, FileCheck, History, Landmark, Scale, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  IRS_CORRECTED_DATE_NOTE,
  IRS_REVOCATION_DATE_NOTE_LINK_LABEL,
  IRS_REVOCATION_DATE_NOTE_URL,
  IRS_STANDING_CHIP_ARIA,
  IRS_STANDING_FACT_LABELS,
  IRS_STANDING_LABELS,
  IRS_STANDING_TITLE,
  IRS_TEOS_LINK_LABEL,
  IRS_TEOS_LINK_NOTE,
  IRS_TEOS_URL,
  hasCorrectedRevocationDate,
  irsDecidingFileDate,
  irsRevokedApplyNote,
  irsStandingChipLabel,
  irsStandingStatement,
  pub78ClassLabels,
} from "@/lib/content/irs-standing-copy";
import { formatDate, formatEin, shaPrefix } from "@/lib/format";
import type { IrsStanding, IrsStandingValue } from "@/lib/queries/corpus/standing-types";
import { cn } from "@/lib/utils";

/**
 * Colour is never the only signal: every state has its own icon and its own
 * words. `not_listed` is deliberately a neutral outline chip, never a warning
 * colour: being on no list is an absence, not a finding.
 */
const STATE: Record<IrsStandingValue, { variant: "source" | "danger" | "warning" | "outline"; Icon: LucideIcon }> = {
  listed: { variant: "source", Icon: FileCheck },
  revoked: { variant: "danger", Icon: ShieldAlert },
  revoked_then_relisted: { variant: "outline", Icon: History },
  lists_disagree: { variant: "warning", Icon: Scale },
  not_listed: { variant: "outline", Icon: CircleHelp },
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className="tnum text-ink-2">{children}</dd>
    </>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-ink-4">
      ·
    </span>
  );
}

/**
 * The chain-of-custody line for an IRS list. Same look as <ProvenanceSeal />,
 * but the slot that holds a filing year there holds the list's own date here
 * (a list has no filing year, and the date is the fact that matters).
 */
function IrsFileSeal({ standing }: { standing: IrsStanding }) {
  const p = standing.provenance;
  return (
    <span
      data-slot="provenance-seal"
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-source-border bg-source-tint/60 px-2 py-1 text-xs text-ink-2"
    >
      <span className="inline-flex items-center gap-1 font-medium text-source">
        <ShieldCheck className="size-3.5" aria-hidden />
        {p.source}
      </span>
      <Dot />
      <span className="tnum">{irsDecidingFileDate(standing)}</span>
      {p.sha256 ? (
        <>
          <Dot />
          <span className="tnum font-mono text-ink-3" title={`sha256 of the file we read: ${p.sha256}`}>
            file fingerprint {shaPrefix(p.sha256)}
          </span>
        </>
      ) : null}
      {p.license ? (
        <>
          <Dot />
          <span>{p.license}</span>
        </>
      ) : null}
    </span>
  );
}

/** What the IRS lists say, with each list's date, the file it came from, and the IRS's own search. */
export function IrsStandingDetails({ standing, className }: { standing: IrsStanding; className?: string }) {
  const s = standing;
  const corrected = hasCorrectedRevocationDate(s);
  const classes = pub78ClassLabels(s);

  return (
    <div data-slot="irs-standing-details" className={cn("flex flex-col gap-3 text-sm", className)}>
      <div className="flex items-center gap-1.5 text-source">
        <Landmark className="size-3.5" aria-hidden />
        <span className="eyebrow">{IRS_STANDING_TITLE}</span>
      </div>

      <div className="flex flex-col gap-2 leading-relaxed text-ink-2">
        {irsStandingStatement(s).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
      </div>

      {s.revocationDate || classes.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
          {s.revocationDate ? (
            <Fact label={IRS_STANDING_FACT_LABELS.revocationDate}>
              <time dateTime={s.effectiveRevocationDate ?? s.revocationDate}>{formatDate(s.effectiveRevocationDate)}</time>
            </Fact>
          ) : null}
          {corrected ? (
            <Fact label={IRS_STANDING_FACT_LABELS.revocationDateAsListed}>
              <time dateTime={s.revocationDate ?? undefined}>{formatDate(s.revocationDate)}</time>
            </Fact>
          ) : null}
          {s.postingDate ? (
            <Fact label={IRS_STANDING_FACT_LABELS.postingDate}>
              <time dateTime={s.postingDate}>{formatDate(s.postingDate)}</time>
            </Fact>
          ) : null}
          {s.reinstatementDate ? (
            <Fact label={s.reinstated ? IRS_STANDING_FACT_LABELS.reinstatementDate : IRS_STANDING_FACT_LABELS.reinstatementNotCounted}>
              <time dateTime={s.reinstatementDate}>{formatDate(s.reinstatementDate)}</time>
            </Fact>
          ) : null}
          {classes.length > 0 ? <Fact label={IRS_STANDING_FACT_LABELS.pub78Class}>{classes.join("; ")}</Fact> : null}
        </dl>
      ) : null}

      {corrected ? (
        <p className="text-xs leading-relaxed text-ink-3">
          {IRS_CORRECTED_DATE_NOTE(s)}{" "}
          <a
            href={IRS_REVOCATION_DATE_NOTE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            {IRS_REVOCATION_DATE_NOTE_LINK_LABEL}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        </p>
      ) : null}

      <div className="border-t pt-3">
        <IrsFileSeal standing={s} />
        <p className="mt-1.5 text-xs text-ink-3">
          EIN <span className="tnum font-mono text-ink-2">{formatEin(s.ein)}</span>
          {s.provenance.objectId ? (
            <>
              {" · "}
              {IRS_STANDING_FACT_LABELS.record} <span className="font-mono text-ink-2">{s.provenance.objectId}</span>
            </>
          ) : null}
        </p>
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        <a
          href={IRS_TEOS_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
        >
          {IRS_TEOS_LINK_LABEL}
          <ArrowUpRight className="size-3" aria-hidden />
        </a>
        <span className="mt-1 block">{IRS_TEOS_LINK_NOTE}</span>
      </p>
    </div>
  );
}

/**
 * IRS standing chip. Click it to read the IRS's own dated statement and to
 * reach the IRS Tax Exempt Organization Search.
 *
 * `standing` is null when the two IRS lists are not both loaded (or the
 * organization has no EIN). The chip then renders `fallback`, which is
 * nothing by default. It never falls back to "listed".
 *
 * `compact` shows the short state name without its date (search cards,
 * tables); the popover still carries every date.
 */
export function IrsStandingChip({
  standing,
  compact = false,
  fallback = null,
  className,
}: {
  standing: IrsStanding | null | undefined;
  compact?: boolean;
  fallback?: React.ReactNode;
  className?: string;
}) {
  if (!standing) return <>{fallback}</>;
  const { variant, Icon } = STATE[standing.standing];
  const label = compact ? IRS_STANDING_LABELS[standing.standing] : irsStandingChipLabel(standing);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="irs-standing-chip"
          data-standing={standing.standing}
          className={cn("max-w-full cursor-pointer rounded-sm text-left", className)}
          aria-label={IRS_STANDING_CHIP_ARIA(label)}
        >
          <Badge variant={variant} className="max-w-full whitespace-normal text-left">
            <Icon aria-hidden />
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="max-h-(--radix-popover-content-available-height) w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-4"
      >
        <IrsStandingDetails standing={standing} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The one sentence that sits above the posture explainer in "Can I apply?"
 * when the IRS automatically revoked the organization. Renders nothing for
 * every other standing, and nothing when standing is unknown.
 */
export function IrsRevokedNotice({
  standing,
  fy,
  className,
}: {
  standing: IrsStanding | null | undefined;
  /** Fiscal year of the return the application details come from. */
  fy?: number | null;
  className?: string;
}) {
  if (!standing || standing.standing !== "revoked") return null;
  return (
    <p
      role="note"
      data-slot="irs-revoked-notice"
      className={cn("flex items-start gap-2 rounded-md bg-danger-tint px-3 py-2 text-sm leading-relaxed text-ink-2", className)}
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
      <span>{irsRevokedApplyNote(standing, fy)}</span>
    </p>
  );
}

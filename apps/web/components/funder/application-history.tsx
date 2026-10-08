import { POSTURE_LABELS, type PostureValue } from "@/components/data/posture";
import { SourceValue } from "@/components/data/source-chip";
import {
  APPLICATION_HISTORY_EYEBROW,
  APPLICATION_HISTORY_NOTE,
  POSTURE_HISTORY_ALSO_SAID,
  POSTURE_HISTORY_K_OF_N,
  POSTURE_HISTORY_LATEST_SILENT,
  POSTURE_HISTORY_OTHER_ANSWER,
  POSTURE_HISTORY_OTHER_SOURCE_LABEL,
  POSTURE_HISTORY_SAME,
  POSTURE_HISTORY_SILENT_COUNT,
  TURNOVER_LISTED,
  TURNOVER_NOTE,
  TURNOVER_NOT_ON_EARLIER_LISTS,
  TURNOVER_SOURCE_LABEL,
} from "@/lib/content/application-history-copy";
import { filingSourceLabel } from "@/lib/content/labels";
import {
  historyMatchesBadge,
  postureHistoryCase,
  showableTurnover,
  type ApplicationHistory,
  type PostureHistory,
  type PostureHistoryCase,
} from "@/lib/queries/corpus/application-history-types";
import { cn } from "@/lib/utils";

import { Seal, SourceWithSeal } from "./provenance";

/** The other stated answer, with the earlier return's own seal when there is one to cite. */
function OtherAnswer({ history, nOther }: { history: PostureHistory; nOther: number }) {
  const other = history.other;
  if (!other || nOther < 1) return null;
  const label = POSTURE_LABELS[other.posture];
  // No seal for the earlier return (not publishable, or replaced since the
  // count): say how many returns gave the answer and cite no single return.
  if (!other.provenance) return <> {POSTURE_HISTORY_ALSO_SAID(nOther, label)}</>;
  const parts = POSTURE_HISTORY_OTHER_ANSWER(nOther, other.fy);
  return (
    <>
      {" "}
      {parts.before}
      <SourceValue label={POSTURE_HISTORY_OTHER_SOURCE_LABEL(other.fy)} provenance={<Seal p={other.provenance} />}>
        {label}
      </SourceValue>
      {parts.after}
    </>
  );
}

function HistoryText({ history, c }: { history: PostureHistory; c: Exclude<PostureHistoryCase, { kind: "none" }> }) {
  if (c.kind === "same") return <>{POSTURE_HISTORY_SAME(c.n, history.firstFy, history.lastFy)}</>;
  if (c.kind === "mixed") {
    return (
      <>
        {POSTURE_HISTORY_K_OF_N(c.k, c.n, history.firstFy, history.lastFy)}
        <OtherAnswer history={history} nOther={c.nOther} />
        {c.nSilent > 0 ? <> {POSTURE_HISTORY_SILENT_COUNT(c.nSilent)}</> : null}
      </>
    );
  }
  return (
    <>
      {POSTURE_HISTORY_LATEST_SILENT(history.latestFy)}
      <OtherAnswer history={history} nOther={c.nOther} />
      {c.third && c.nThird > 0 ? <> {POSTURE_HISTORY_ALSO_SAID(c.nThird, POSTURE_LABELS[c.third])}</> : null}
    </>
  );
}

/**
 * "What its returns show": up to two plain lines under the "Can I apply?"
 * answer, each with the seal of the return it was read from.
 *
 *   1. How the foundation answered the application question across its
 *      Form 990-PF returns ("the same way on all 5", "this way on 3 of 5",
 *      or the earlier answer when the newest return is silent).
 *   2. How many of the newest year's named grant recipients are not on the
 *      foundation's lists for the three years before ("4 of 10"). Grants the
 *      foundation marked as paid to an individual are not in that count.
 *
 * There was a third line that quoted words from the instructions that read
 * like a limit ("by invitation"). It is gone: the matched words often did
 * not mean a limit (see application-history-copy.ts), and the page must not
 * quote misleading words. The reader no longer carries those words.
 *
 * Both are sourced facts from public filings. No model is involved, so
 * nothing here carries an AI marking; there is no score and no advice. The
 * component says what past returns hold and stops there.
 *
 * It prints a line only when the line can be sealed and trusted, and renders
 * nothing at all when no line passes:
 *   - line 1 needs the history row to be read from the same return as the
 *     badge (`applicationObjectId`) with the same answer;
 *   - line 1 is left out for a single return and for a foundation that is
 *     silent on every return;
 *   - line 2 is left out when the foundation has no row for its newest year
 *     (which includes a foundation whose grants are mostly to individuals),
 *     when an earlier list had placeholder rows, or when the filing has no
 *     seal. No row is never shown as a zero.
 *
 * Server or client component; no state, no JavaScript of its own.
 *
 * Place it in components/funder/apply-section.tsx, right after the closing
 * "Application policy: ..." paragraph:
 *   <ApplicationHistoryBlock history={history} posture={posture} applicationObjectId={app.objectId} />
 */
export function ApplicationHistoryBlock({
  history,
  posture,
  applicationObjectId,
  className,
}: {
  history: ApplicationHistory | null | undefined;
  /** The answer the section's badge shows. */
  posture: PostureValue;
  /** The filing the badge was read from (funder.application.objectId). */
  applicationObjectId: string | null | undefined;
  className?: string;
}) {
  const h = history?.history ?? null;
  const usable = historyMatchesBadge(h, posture, applicationObjectId) ? h : null;
  const c = postureHistoryCase(usable);
  const turnover = showableTurnover(history?.turnover);

  const showHistory = usable !== null && c.kind !== "none";
  if (!showHistory && !turnover) return null;

  return (
    <div data-slot="application-history" className={cn("mt-4 border-t border-border/70 pt-3", className)}>
      <h3 className="eyebrow mb-2 text-muted-foreground">{APPLICATION_HISTORY_EYEBROW}</h3>
      <ul className="flex flex-col gap-2 text-[13.5px] leading-relaxed text-ink-2">
        {usable && usable.provenance && c.kind !== "none" ? (
          <li data-slot="posture-history">
            <HistoryText history={usable} c={c} />{" "}
            <SourceWithSeal label={filingSourceLabel("990PF", usable.latestFy)} p={usable.provenance} className="align-baseline" />
          </li>
        ) : null}

        {turnover && turnover.provenance ? (
          <li data-slot="recipient-turnover">
            {TURNOVER_LISTED(turnover.fy, turnover.nRecipients)}{" "}
            <SourceValue label={TURNOVER_SOURCE_LABEL(turnover.fy)} provenance={<Seal p={turnover.provenance} />}>
              {TURNOVER_NOT_ON_EARLIER_LISTS(turnover.nNew, turnover.nRecipients, turnover.windowFirstFy, turnover.windowLastFy)}
            </SourceValue>{" "}
            <SourceWithSeal label={filingSourceLabel("990PF", turnover.fy)} p={turnover.provenance} className="align-baseline" />
          </li>
        ) : null}
      </ul>

      {showHistory ? <p className="mt-2 text-xs leading-relaxed text-ink-3">{APPLICATION_HISTORY_NOTE}</p> : null}
      {turnover ? <p className="mt-2 text-xs leading-relaxed text-ink-3">{TURNOVER_NOTE(turnover.nUnnamedRows)}</p> : null}
    </div>
  );
}

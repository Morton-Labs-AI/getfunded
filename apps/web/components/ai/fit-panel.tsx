import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";

import { AiBadge, AiCard } from "@/components/data/ai-badge";
import { Money } from "@/components/data/money";
import { UpgradeNotice } from "@/components/settings/upgrade-notice";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AI_COPY, RATING_LABELS } from "@/lib/ai/copy";
import type { EvidenceItem } from "@/lib/ai/evidence";
import { getLatestFit, type LatestFit } from "@/lib/ai/fit";
import { FIT_DIMENSIONS, FIT_DIMENSION_HINTS, FIT_DIMENSION_LABELS, type FitDimension, type FitReason } from "@/lib/ai/fit-schema";
import { aiMode } from "@/lib/billing/meter";
import { formatDateTime } from "@/lib/format";
import { CREDIT_COSTS, can, isSelfHosted, planFor } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/lib/workspace/context";

import { EvidenceChip, EvidenceChips, evidenceAnchor } from "./evidence-chip";
import { AnalyzeButton, FeedbackButtons } from "./fit-actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The fit panel for one funder in the signed-in workspace. Server component:
 * loads the latest stored analysis (lib/ai/fit → lib/ai/analyses) under RLS,
 * checks whether the evidence changed since it ran, and renders everything
 * inside <AiCard /> so nothing machine-suggested ever reads as a fact. Every
 * reason shows the evidence it cites; the composite score is arithmetic over
 * the seven dimension scores, done here, not by the model.
 *
 * Reads the session, so it wraps itself in <Suspense>: drop it anywhere on
 * the funder page without extra plumbing.
 */
export function FitPanel(props: { orgId: string; savedFunderId?: string }) {
  return (
    <Suspense fallback={<FitPanelSkeleton />}>
      <FitPanelContent {...props} />
    </Suspense>
  );
}

export function FitPanelSkeleton() {
  return (
    <section data-slot="ai-card" className="data-ai p-4" aria-busy>
      <div className="mb-3 flex items-center gap-2">
        <AiBadge />
        <h3 className="text-[13px] font-semibold text-foreground">{AI_COPY.fit.title}</h3>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </section>
  );
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^NEXT_/.test(digest);
}

async function FitPanelContent({ orgId, savedFunderId }: { orgId: string; savedFunderId?: string }) {
  const { user, workspace } = await requireWorkspace();
  const plan = planFor(workspace);
  const selfHosted = isSelfHosted();

  if (!can(plan, "fit")) {
    return (
      <AiCard title={AI_COPY.fit.title}>
        <UpgradeNotice feature="fit" selfHosted={selfHosted} compact />
      </AiCard>
    );
  }

  const aiDisabled = aiMode() === "disabled";
  const credits = CREDIT_COSTS.fit;
  const profileThin = !workspace.profile.mission && !(workspace.profile.program_areas?.length ?? 0);

  let latest: LatestFit | null = null;
  let loadFailed = false;
  if (UUID_RE.test(orgId)) {
    try {
      latest = await getLatestFit({ userId: user.id, workspaceId: workspace.id }, orgId, { checkStale: true });
    } catch (err) {
      if (isNextControlFlow(err)) throw err;
      loadFailed = true;
      console.error("[fit-panel]", err instanceof Error ? `${err.name}: ${err.message}` : err);
    }
  }

  if (!latest) {
    return (
      <AiCard title={AI_COPY.fit.title} reason={AI_COPY.fit.emptyHint}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground">{loadFailed ? "The last analysis could not be loaded right now." : AI_COPY.fit.empty}</p>
          <p className="max-w-prose text-sm leading-6 text-ink-3">{AI_COPY.fit.emptyHint}</p>
          {profileThin ? <ProfileHint /> : null}
          {aiDisabled ? <DisabledNote /> : null}
          <AnalyzeButton orgId={orgId} savedFunderId={savedFunderId} hasAnalysis={false} credits={credits} aiDisabled={aiDisabled} />
          <p className="text-xs text-ink-4">{AI_COPY.disclaimer}</p>
        </div>
      </AiCard>
    );
  }

  const { row, analysis: a, evidence, feedback, stale } = latest;
  const analysisId = row.id;
  const ratingWord = RATING_LABELS[a.rating] ?? a.rating;

  return (
    <div className="flex flex-col gap-4" data-slot="fit-panel">
      <AiCard
        title={AI_COPY.fit.title}
        reason={AI_COPY.fit.emptyHint}
        meta={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {stale ? (
              <Badge variant="warning" title={AI_COPY.fit.staleHint}>
                <AlertTriangle aria-hidden />
                {AI_COPY.fit.stale}
              </Badge>
            ) : null}
            {row.isMock ? <Badge variant="outline">Mock model</Badge> : null}
            <span className="tnum text-xs text-ink-3">
              <time dateTime={row.createdAt}>{formatDateTime(row.createdAt)}</time> · {a.model}
            </span>
            <AnalyzeButton orgId={orgId} savedFunderId={savedFunderId ?? row.savedFunderId ?? undefined} hasAnalysis credits={credits} aiDisabled={aiDisabled} className="flex flex-col items-end gap-2" />
          </div>
        }
      >
        {stale ? <p className="mb-3 text-xs text-warning">{AI_COPY.fit.staleHint}</p> : null}
        {aiDisabled ? <DisabledNote /> : null}

        <div className="flex flex-wrap items-start gap-6">
          <div className="text-center">
            <div className="tnum font-mono text-[44px] font-semibold leading-none text-foreground" aria-label={`Fit score ${a.overallScore} of 100`}>
              {a.overallScore}
            </div>
            <div className="mt-1 text-[13px] font-medium text-ai">{ratingWord} fit</div>
            <div className="mt-0.5 text-[10.5px] text-ink-4" title={AI_COPY.fit.composite}>
              weighted composite · {a.weightsVersion}
            </div>
          </div>
          <p className="min-w-64 flex-1 text-sm leading-6 text-ink-2">{a.summary}</p>
        </div>

        <ul className="mt-5 grid grid-cols-1 gap-x-8 gap-y-1 lg:grid-cols-2" aria-label="Fit dimensions">
          {FIT_DIMENSIONS.map((k) => (
            <li key={k}>
              <DimensionRow dimension={k} score={a.dimensions[k].score} statement={a.dimensions[k].statement} evidenceIds={a.dimensions[k].evidenceIds} confidence={a.dimensions[k].confidence} items={evidence} analysisId={analysisId} />
            </li>
          ))}
        </ul>
      </AiCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AiCard title={AI_COPY.fit.reasons}>
          <ReasonList reasons={a.topReasons} items={evidence} analysisId={analysisId} />
        </AiCard>
        <AiCard title={AI_COPY.fit.concerns}>
          {a.concerns.length === 0 ? <p className="text-sm text-ink-3">{AI_COPY.fit.noConcerns}</p> : <ReasonList reasons={a.concerns} items={evidence} analysisId={analysisId} />}
        </AiCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AiCard title={AI_COPY.fit.ask}>
          {a.suggestedAsk ? (
            <>
              <p className="text-lg font-semibold text-foreground">
                <Money value={a.suggestedAsk.min} compact /> – <Money value={a.suggestedAsk.max} compact />
              </p>
              <p className="mt-0.5 text-xs text-ink-3">Confidence: {a.suggestedAsk.confidence}</p>
              <p className="mt-1.5 text-sm leading-6 text-ink-2">{a.suggestedAsk.rationale}</p>
              <EvidenceChips ids={a.suggestedAsk.evidenceIds} items={evidence} analysisId={analysisId} />
            </>
          ) : (
            <p className="text-sm text-ink-3">{AI_COPY.fit.askNone}</p>
          )}
        </AiCard>
        <AiCard title={AI_COPY.fit.nextStep}>
          {a.suggestedNextStep ? (
            <>
              <p className="text-sm font-medium text-foreground">{a.suggestedNextStep.action}</p>
              <p className="mt-1 text-sm leading-6 text-ink-2">{a.suggestedNextStep.rationale}</p>
            </>
          ) : (
            <p className="text-sm text-ink-3">No next step suggested.</p>
          )}
        </AiCard>
        <AiCard title={AI_COPY.fit.angle}>
          {a.approachAngle ? <p className="text-sm leading-6 whitespace-pre-wrap text-ink-2">{a.approachAngle}</p> : <p className="text-sm text-ink-3">Nothing in the evidence supports an angle yet.</p>}
        </AiCard>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-ai-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <AiBadge />
          {AI_COPY.disclaimer}
        </p>
        <FeedbackButtons analysisId={analysisId} verdict={feedback?.verdict ?? null} />
      </div>

      <EvidenceList items={evidence} analysisId={analysisId} />
    </div>
  );
}

function ProfileHint() {
  return (
    <p className="rounded-md border border-border bg-inset px-3 py-2 text-sm text-ink-2" role="status">
      {AI_COPY.fit.profileMissing}{" "}
      <Link href="/app/settings/organization" className="font-medium text-primary hover:underline">
        Open organization settings
      </Link>
    </p>
  );
}

function DisabledNote() {
  return (
    <p className="mb-3 rounded-md border border-border bg-inset px-3 py-2 text-sm text-ink-2" role="status">
      <span className="font-medium text-foreground">{AI_COPY.disabled.title}.</span> {AI_COPY.disabled.hint}
    </p>
  );
}

function barTone(score: number): string {
  if (score >= 70) return "bg-success";
  if (score >= 45) return "bg-warning";
  return "bg-ink-4";
}

function DimensionRow({
  dimension,
  score,
  statement,
  evidenceIds,
  confidence,
  items,
  analysisId,
}: {
  dimension: FitDimension;
  score: number;
  statement: string;
  evidenceIds: string[];
  confidence: string;
  items: EvidenceItem[];
  analysisId: string;
}) {
  const rounded = Math.round(score);
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-sm py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" title={FIT_DIMENSION_HINTS[dimension]}>
        <span className="w-40 shrink-0 text-[12.5px] text-ink-3">{FIT_DIMENSION_LABELS[dimension]}</span>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-inset" role="img" aria-label={`${FIT_DIMENSION_LABELS[dimension]}: ${rounded} of 100`}>
          <span className={cn("block h-full rounded-full", barTone(rounded))} style={{ width: `${Math.max(3, Math.min(100, rounded))}%` }} />
        </span>
        <span className="tnum w-8 text-right font-mono text-[13px] font-semibold text-foreground">{rounded}</span>
      </summary>
      <div className="mb-2 ml-0 rounded-md bg-surface/70 p-2.5 text-[13px] text-ink-2 lg:ml-40">
        {statement}
        <span className="ml-1 text-xs text-ink-4">({confidence} confidence)</span>
        <EvidenceChips ids={evidenceIds} items={items} analysisId={analysisId} />
      </div>
    </details>
  );
}

function ReasonList({ reasons, items, analysisId }: { reasons: FitReason[]; items: EvidenceItem[]; analysisId: string }) {
  return (
    <ul className="space-y-3">
      {reasons.map((r, i) => (
        <li key={i} className="text-sm leading-6 text-ink-2">
          {r.statement}
          <span className="ml-1 text-xs text-ink-4">({r.confidence} confidence)</span>
          <EvidenceChips ids={r.evidenceIds} items={items} analysisId={analysisId} />
        </li>
      ))}
    </ul>
  );
}

/** Every item the model was shown, with the ids the chips link to. Collapsed by default; nothing is hidden. */
function EvidenceList({ items, analysisId }: { items: EvidenceItem[]; analysisId: string }) {
  if (items.length === 0) return null;
  const sourceCount = items.filter((i) => i.cls === "source").length;
  return (
    <details className="rounded-lg border bg-surface px-4 py-3">
      <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
        {AI_COPY.fit.evidence} {items.length} evidence item{items.length === 1 ? "" : "s"}
        <span className="ml-1 font-normal text-ink-3">
          ({sourceCount} from public filings, {items.length - sourceCount} from your workspace)
        </span>
      </summary>
      <ol className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.id} id={evidenceAnchor(analysisId, item.id)} className="flex scroll-mt-24 flex-col gap-1 rounded-md px-1 py-1 text-sm target:bg-primary-tint/50 sm:flex-row sm:items-start sm:gap-3">
            <span className="flex shrink-0 items-center gap-2">
              <code className="font-mono text-[11px] text-ink-3">[{item.id}]</code>
              <EvidenceChip item={item} analysisId={analysisId} />
            </span>
            <span className="leading-6 text-ink-2">{item.text}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

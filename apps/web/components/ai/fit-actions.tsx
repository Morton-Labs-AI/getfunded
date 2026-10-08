"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { postAi, type AiApiError } from "@/lib/ai/api-client";
import type { FeedbackResponse, FitResponse } from "@/lib/ai/api-schemas";
import { AI_COPY } from "@/lib/ai/copy";
import type { FeedbackVerdict } from "@/lib/ai/analyses";

import { AiErrorNotice } from "./ai-error-notice";

/** "Uses 5 credits." in words, never an abbreviation. */
export function creditsLabel(credits: number): string {
  return `Uses ${credits} credit${credits === 1 ? "" : "s"}.`;
}

/**
 * "Analyze fit" / "Re-analyze": a client-driven long fetch with staged
 * progress copy (a timer, not token streaming: the artifact is validated
 * JSON and half a JSON object is not a UX). On success the server component
 * re-renders from the stored row. Quota and kill-switch answers render
 * inline with a link to Billing; nothing here ever shows a model's guess as
 * a fact.
 */
export function AnalyzeButton({
  orgId,
  savedFunderId,
  hasAnalysis,
  credits,
  aiDisabled = false,
  className,
}: {
  orgId: string;
  savedFunderId?: string;
  hasAnalysis: boolean;
  credits: number;
  /** AI_ENABLED=false: the button stays visible but explains instead of calling. */
  aiDisabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = React.useState(false);
  const [stage, setStage] = React.useState(0);
  const [error, setError] = React.useState<AiApiError | null>(null);
  const [, startTransition] = React.useTransition();
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function run() {
    if (running) return;
    if (aiDisabled) {
      setError({ kind: "disabled", status: 503, code: "ai_disabled", message: AI_COPY.disabled.hint });
      return;
    }
    setError(null);
    setRunning(true);
    setStage(0);
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, AI_COPY.fit.running.length - 1)), 4000);
    try {
      const result = await postAi<FitResponse>("/api/ai/fit", { orgId, savedFunderId: savedFunderId ?? null, force: hasAnalysis });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.reused) {
        toast.info("Nothing changed since the last analysis", { description: "The evidence and your profile are the same, so no credits were used." });
      } else {
        toast.success(result.data.isMock ? "Analysis complete (mock model)" : "Analysis complete", {
          description: `${result.data.analysis.overallScore} of 100. Every reason cites the evidence it rests on.`,
        });
      }
      startTransition(() => router.refresh());
    } finally {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setRunning(false);
    }
  }

  return (
    <div className={className ?? "flex flex-col items-start gap-2"}>
      {running ? (
        <span className="inline-flex items-center gap-2 text-[13px] text-ai" role="status" aria-live="polite">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          {AI_COPY.fit.running[stage]}
        </span>
      ) : (
        <Button variant="ai" size="sm" onClick={run}>
          <Sparkles aria-hidden />
          {hasAnalysis ? AI_COPY.fit.reanalyze : AI_COPY.fit.analyze}
          <span className="tnum text-[11px] font-normal opacity-80">{creditsLabel(credits)}</span>
        </Button>
      )}
      {error ? <AiErrorNotice error={error} className="max-w-sm" /> : null}
    </div>
  );
}

/**
 * Accept / Dismiss for one stored analysis. Both append a row to
 * `ai_feedback`; neither changes the analysis, which is append-only too.
 */
export function FeedbackButtons({ analysisId, verdict, className }: { analysisId: string; verdict: FeedbackVerdict | null; className?: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<FeedbackVerdict | null>(null);
  const [error, setError] = React.useState<AiApiError | null>(null);
  const [, startTransition] = React.useTransition();

  async function send(next: "accepted" | "dismissed") {
    if (pending) return;
    setError(null);
    setPending(next);
    try {
      const result = await postAi<FeedbackResponse>("/api/ai/feedback", { analysisId, verdict: next });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(next === "accepted" ? AI_COPY.fit.accepted : AI_COPY.fit.dismissed);
      startTransition(() => router.refresh());
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={className ?? "flex flex-col gap-2"}>
      <div className="flex flex-wrap items-center gap-2">
        {verdict === "accepted" ? (
          <span className="inline-flex items-center gap-1 text-[13px] text-success">
            <Check className="size-3.5" aria-hidden />
            {AI_COPY.fit.accepted}
          </span>
        ) : verdict === "dismissed" ? (
          <span className="inline-flex items-center gap-1 text-[13px] text-ink-3">
            <X className="size-3.5" aria-hidden />
            {AI_COPY.fit.dismissed}
          </span>
        ) : null}
        {verdict !== "accepted" ? (
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => send("accepted")}>
            {pending === "accepted" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {AI_COPY.fit.accept}
          </Button>
        ) : null}
        {verdict !== "dismissed" ? (
          <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => send("dismissed")}>
            {pending === "dismissed" ? <LoaderCircle className="animate-spin" aria-hidden /> : <X aria-hidden />}
            {AI_COPY.fit.dismiss}
          </Button>
        ) : null}
      </div>
      {error ? <AiErrorNotice error={error} className="max-w-sm" /> : null}
    </div>
  );
}

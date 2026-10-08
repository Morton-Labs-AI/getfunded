"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { postAi, type AiApiError } from "@/lib/ai/api-client";
import type { ResearchResponse } from "@/lib/ai/api-schemas";
import { AI_COPY } from "@/lib/ai/copy";

import { AiErrorNotice } from "./ai-error-notice";
import { creditsLabel } from "./fit-actions";

/**
 * "Research on the web" / "Refresh research": a client-driven long fetch with
 * staged progress copy (a timer, not token streaming). On success the server
 * component re-renders from the stored row. Quota, plan and kill-switch
 * answers render inline with a link to Billing. Nothing here ever shows a
 * model's guess as a fact.
 */
export function ResearchButton({
  orgId,
  savedFunderId,
  hasDossier,
  credits,
  aiDisabled = false,
  className,
}: {
  orgId: string;
  savedFunderId?: string;
  hasDossier: boolean;
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
    timer.current = setInterval(() => setStage((s) => Math.min(s + 1, AI_COPY.research.running.length - 1)), 6000);
    try {
      const result = await postAi<ResearchResponse>("/api/ai/research", { orgId, savedFunderId: savedFunderId ?? null, force: hasDossier });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.reused) {
        toast.info("Recent research already on file", { description: "It is less than a month old, so no credits were used. Use Refresh research to search again." });
      } else {
        toast.success(result.data.isMock ? "Research complete (test output)" : "Research complete", {
          description: `${result.data.dossier.sources.length} web page${result.data.dossier.sources.length === 1 ? "" : "s"} cited. Read it against the sources before you rely on it.`,
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
          {AI_COPY.research.running[stage]}
        </span>
      ) : (
        <Button variant="ai" size="sm" onClick={run}>
          <Globe aria-hidden />
          {hasDossier ? AI_COPY.research.rerun : AI_COPY.research.run}
          <span className="tnum text-[11px] font-normal opacity-80">{creditsLabel(credits)}</span>
        </Button>
      )}
      {error ? <AiErrorNotice error={error} className="max-w-sm" /> : null}
    </div>
  );
}

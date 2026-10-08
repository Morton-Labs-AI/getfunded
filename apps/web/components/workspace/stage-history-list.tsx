import { ArrowRight } from "lucide-react";

import { formatDateTime } from "@/lib/format";
import { STAGE_LABELS } from "@/lib/workspace/stages";
import type { StageHistoryRow } from "@/lib/workspace/types";

/** Every stage move, newest first. Written by `getfunded.move_stage()`, so it cannot drift from the funder's stage. */
export function StageHistoryList({ history }: { history: StageHistoryRow[] }) {
  if (history.length === 0) return <p className="text-sm text-ink-3">No stage moves yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {history.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            {h.fromStage ? (
              <>
                <span className="text-ink-3">{STAGE_LABELS[h.fromStage]}</span>
                <ArrowRight className="size-3.5 text-ink-4" aria-hidden />
              </>
            ) : null}
            {STAGE_LABELS[h.toStage]}
          </span>
          <span className="tnum text-xs text-ink-3">
            {formatDateTime(h.createdAt)}
            {h.changedByName ? ` · ${h.changedByName}` : ""}
          </span>
          {h.note ? <span className="basis-full text-xs text-ink-2">{h.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

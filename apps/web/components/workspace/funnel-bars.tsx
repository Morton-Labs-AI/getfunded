import { STAGE_LABELS } from "@/lib/workspace/stages";
import type { ReachRow } from "@/lib/workspace/stages";
import { cn } from "@/lib/utils";

/**
 * The pipeline funnel as horizontal bars. Server-renderable, no chart
 * library: the numbers are small and the bars are the whole story.
 *
 * `reached` is how many funders got to this stage or beyond (monotonically
 * non-increasing by construction, see `stageReach`); `current` is how many
 * sit there today. Colour carries no meaning on its own: every bar has its
 * label and its numbers in text.
 */
export function FunnelBars({ rows, className }: { rows: ReachRow[]; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.reached));
  return (
    <ol className={cn("flex flex-col gap-2", className)} aria-label="Pipeline funnel">
      {rows.map((r) => {
        const pct = Math.round((r.reached / max) * 100);
        return (
          <li key={r.stage} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
            <span className="truncate text-ink-2">{STAGE_LABELS[r.stage]}</span>
            <span className="relative block h-5 overflow-hidden rounded-sm bg-inset" aria-hidden>
              <span
                className="absolute inset-y-0 left-0 rounded-sm bg-primary/80 transition-[width] duration-200"
                style={{ width: `${r.reached === 0 ? 0 : Math.max(pct, 2)}%` }}
              />
            </span>
            <span className="tnum shrink-0 text-right text-xs text-ink-3">
              <span className="font-mono font-semibold text-foreground">{r.reached}</span> reached
              <span className="text-ink-4"> · </span>
              {r.current} now
            </span>
          </li>
        );
      })}
    </ol>
  );
}

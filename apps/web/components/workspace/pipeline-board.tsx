"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, GripVertical } from "lucide-react";
import { toast } from "sonner";

import { Money } from "@/components/data/money";
import { formatDate, formatMoneyCompact } from "@/lib/format";
import { moveStageAction } from "@/lib/workspace/actions";
import { BOARD_STAGES, RAIL_STAGES, STAGE_HINTS, STAGE_LABELS, STAGES, TIER_LABELS, type Stage } from "@/lib/workspace/stages";
import type { SavedFunder } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

import { NativeSelect } from "./native-select";

/**
 * Kanban. The board owns card positions, seeded from the server render. A
 * drop moves the card at once, then persists through `moveStageAction`
 * (which calls `getfunded.move_stage()` with the card's version, so a stale
 * card is refused). Failure reverts the card and reloads. Every card also
 * carries a native stage select, so keyboard and screen-reader users move
 * cards without dragging.
 */
export function PipelineBoard({ initial }: { initial: SavedFunder[] }) {
  const router = useRouter();
  const [rows, setRows] = React.useState(initial);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const initialRef = React.useRef(initial);
  if (initialRef.current !== initial) {
    // Fresh server data (after a revalidate): adopt it.
    initialRef.current = initial;
    setRows(initial);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const byStage = React.useMemo(() => {
    const map = new Map<Stage, SavedFunder[]>();
    for (const s of STAGES) map.set(s, []);
    for (const r of rows) map.get(r.stage)?.push(r);
    return map;
  }, [rows]);

  const active = activeId ? rows.find((r) => r.id === activeId) : null;

  function applyMove(id: string, target: Stage) {
    const row = rows.find((r) => r.id === id);
    if (!row || row.stage === target) return;
    const from = row.stage;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stage: target } : r)));
    void moveStageAction({ id, stage: target, expectedVersion: row.version }).then((result) => {
      if (result.ok) {
        setRows((rs) => rs.map((r) => (r.id === id ? { ...r, version: result.version } : r)));
        return;
      }
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, stage: from } : r)));
      if (result.code === "stale") {
        toast.warning("Changed somewhere else", { description: result.message });
      } else {
        toast.error("Could not move", { description: result.message });
      }
      router.refresh();
    });
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const target = e.over?.id ? (String(e.over.id) as Stage) : null;
    if (!target) return;
    applyMove(String(e.active.id), target);
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex gap-3 overflow-x-auto pb-4" role="list" aria-label="Pipeline stages">
        {BOARD_STAGES.map((stage) => (
          <Column key={stage} stage={stage} cards={byStage.get(stage) ?? []} onMove={applyMove} />
        ))}
        <div className="flex w-60 shrink-0 flex-col gap-3">
          {RAIL_STAGES.map((stage) => (
            <Column key={stage} stage={stage} cards={byStage.get(stage) ?? []} compact onMove={applyMove} />
          ))}
        </div>
      </div>
      <DragOverlay>{active ? <Card row={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  cards,
  compact = false,
  onMove,
}: {
  stage: Stage;
  cards: SavedFunder[];
  compact?: boolean;
  onMove: (id: string, target: Stage) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = cards.reduce((sum, c) => sum + (c.askAmount ?? 0), 0);
  const withAsk = cards.filter((c) => c.askAmount !== null).length;
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${STAGE_LABELS[stage]}: ${cards.length} ${cards.length === 1 ? "funder" : "funders"}`}
      className={cn(
        "flex flex-col rounded-lg border bg-inset/60 p-2 transition-colors duration-150",
        compact ? "min-h-28" : "min-h-[60vh] w-64 shrink-0",
        isOver ? "border-primary bg-primary-tint" : "border-border",
      )}
    >
      <header className="mb-2 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="eyebrow text-foreground">{STAGE_LABELS[stage]}</h2>
          <span className="tnum text-[11px] text-ink-3">
            {cards.length}
            {withAsk > 0 ? ` · ${formatMoneyCompact(total)}` : ""}
          </span>
        </div>
        {!compact ? <p className="mt-0.5 text-[11px] leading-4 text-ink-3">{STAGE_HINTS[stage]}</p> : null}
      </header>
      <div className="flex flex-1 flex-col gap-2">
        {cards.map((c) => (
          <DraggableCard key={c.id} row={c} onMove={onMove} />
        ))}
      </div>
    </section>
  );
}

function DraggableCard({ row, onMove }: { row: SavedFunder; onMove: (id: string, target: Stage) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id });
  return (
    <div ref={setNodeRef} className={isDragging ? "opacity-40" : undefined}>
      <Card row={row} dragHandle={{ ...attributes, ...listeners }} onMove={onMove} />
    </div>
  );
}

function Card({
  row,
  dragHandle,
  overlay = false,
  onMove,
}: {
  row: SavedFunder;
  dragHandle?: Record<string, unknown>;
  overlay?: boolean;
  onMove?: (id: string, target: Stage) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = row.nextActionDue !== null && row.nextActionDue <= today;
  return (
    <article className={cn("rounded-md border bg-card p-2.5 shadow-xs", overlay && "rotate-2 shadow-overlay")}>
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          aria-label={`Drag ${row.snapshot.name}`}
          className="mt-0.5 shrink-0 cursor-grab touch-none rounded-sm text-ink-4 hover:text-foreground"
          {...dragHandle}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/app/funders/${row.orgId}`} className="block truncate text-[13px] font-medium text-foreground hover:text-primary hover:underline">
            {row.snapshot.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
            {row.tier ? <span>{TIER_LABELS[row.tier]}</span> : null}
            {row.askAmount !== null ? (
              <span className="font-medium text-ink-2">
                Ask <Money value={row.askAmount} compact mono={false} />
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-3">
            <span className="truncate">{row.ownerName ?? "Nobody yet"}</span>
            {row.nextActionDue ? (
              <span className={cn("tnum inline-flex items-center gap-1", dueSoon && "font-medium text-warning")} title={row.nextAction ?? undefined}>
                <CalendarClock className="size-3" aria-hidden />
                {formatDate(row.nextActionDue)}
              </span>
            ) : null}
          </div>
          {onMove && !overlay ? (
            <NativeSelect
              aria-label={`Stage for ${row.snapshot.name}`}
              className="mt-1.5 text-[11px]"
              value={row.stage}
              onChange={(e) => onMove(row.id, e.target.value as Stage)}
            >
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          ) : null}
        </div>
      </div>
    </article>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { moveStageAction } from "@/lib/workspace/actions";
import { STAGES, STAGE_LABELS, type Stage } from "@/lib/workspace/stages";

import { NativeSelect } from "./native-select";

/**
 * The stage control on a funder's page. Moves go through
 * `getfunded.move_stage()` with the row's version, so a stale page is refused
 * and reloaded instead of overwriting a teammate's move.
 */
export function StageSelect({ id, stage, version, name }: { id: string; stage: Stage; version: number; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState<Stage>(stage);
  // Fresh server data after a revalidate: adopt it (React's "storing
  // information from previous renders" pattern; no effect, no ref).
  const [seenStage, setSeenStage] = React.useState(stage);
  if (seenStage !== stage) {
    setSeenStage(stage);
    setValue(stage);
  }

  function move(target: Stage) {
    if (target === value) return;
    const previous = value;
    setValue(target);
    startTransition(async () => {
      const result = await moveStageAction({ id, stage: target, expectedVersion: version });
      if (result.ok) {
        toast.success(`Moved to ${STAGE_LABELS[target]}`, { description: name });
        return;
      }
      setValue(previous);
      if (result.code === "stale") toast.warning("Changed somewhere else", { description: result.message });
      else toast.error("Could not move", { description: result.message });
      router.refresh();
    });
  }

  return (
    <NativeSelect
      size="default"
      aria-label={`Stage for ${name}`}
      value={value}
      disabled={pending}
      onChange={(e) => move(e.target.value as Stage)}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </NativeSelect>
  );
}

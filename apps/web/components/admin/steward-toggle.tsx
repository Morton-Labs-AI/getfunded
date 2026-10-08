"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { setStewardAccess, type ActionState } from "@/lib/admin/actions";

const INITIAL: ActionState = { ok: false };

/** One button per member: grant or remove steward access. */
export function StewardToggle({ userId, isSteward, isSelf }: { userId: string; isSteward: boolean; isSelf: boolean }) {
  const [state, action, pending] = useActionState(setStewardAccess, INITIAL);
  const next = isSteward ? "false" : "true";
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="is_steward" value={next} />
      <Button
        type="submit"
        size="sm"
        variant={isSteward ? "outline" : "secondary"}
        disabled={pending || (isSteward && isSelf)}
        title={isSteward && isSelf ? "Ask another steward to remove your access." : undefined}
      >
        {pending ? "Saving…" : isSteward ? "Remove steward access" : "Make steward"}
      </Button>
      {state.message ? (
        <p role="status" className={state.ok ? "text-xs text-success" : "text-xs text-danger"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

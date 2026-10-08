"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clearPlanOverride, savePlanOverride, type ActionState } from "@/lib/admin/actions";
import { formatNumber } from "@/lib/format";

const INITIAL: ActionState = { ok: false };

export function PlanOverrideForm({
  workspaceId,
  planName,
  override,
  defaults,
}: {
  workspaceId: string;
  planName: string;
  override: { monthlyCredits: number | null; members: number | null; note: string | null } | null;
  defaults: { monthly_credits: number | null; members: number | null };
}) {
  const [state, save, saving] = useActionState(savePlanOverride, INITIAL);
  const [clearState, clear, clearing] = useActionState(clearPlanOverride, INITIAL);
  const errors = state.fieldErrors ?? {};
  const pending = saving || clearing;
  const message = state.message ?? clearState.message;
  const ok = state.message ? state.ok : clearState.ok;
  const defaultCredits = defaults.monthly_credits === null ? "unlimited" : formatNumber(defaults.monthly_credits);
  const defaultMembers = defaults.members === null ? "unlimited" : formatNumber(defaults.members);

  return (
    <form action={save} className="flex flex-col gap-4">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="monthly_credits">AI credits per month</Label>
          <Input
            id="monthly_credits"
            name="monthly_credits"
            inputMode="numeric"
            defaultValue={override?.monthlyCredits ?? ""}
            placeholder={`${planName} default: ${defaultCredits}`}
            aria-invalid={errors.monthly_credits ? true : undefined}
          />
          {errors.monthly_credits ? <p className="text-xs text-danger">{errors.monthly_credits}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="members">Members</Label>
          <Input
            id="members"
            name="members"
            inputMode="numeric"
            defaultValue={override?.members ?? ""}
            placeholder={`${planName} default: ${defaultMembers}`}
            aria-invalid={errors.members ? true : undefined}
          />
          {errors.members ? <p className="text-xs text-danger">{errors.members}</p> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Why (shown only to stewards)</Label>
        <Textarea id="note" name="note" defaultValue={override?.note ?? ""} maxLength={500} placeholder="Pilot nonprofit, 6 months, agreed with …" aria-invalid={errors.note ? true : undefined} />
        {errors.note ? <p className="text-xs text-danger">{errors.note}</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Empty fields keep the plan default. The daily cap follows the monthly credits (one third). Changes apply to the next AI call.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {saving ? "Saving…" : "Save override"}
        </Button>
        {override ? (
          <Button type="submit" variant="outline" formAction={clear} disabled={pending}>
            {clearing ? "Removing…" : "Remove override"}
          </Button>
        ) : null}
        {message ? (
          <p role="status" className={ok ? "text-sm text-success" : "text-sm text-danger"}>
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

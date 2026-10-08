"use client";

import * as React from "react";
import { useActionState } from "react";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button, type buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { PaidPlanId } from "@/lib/plans";
import { setDailyCapAction, type ActionState } from "@/lib/settings/actions";
import type { VariantProps } from "class-variance-authority";

import { FormNotice } from "./form-notice";

type BillingResponse = { url?: string; error?: { code?: string; message?: string } };

async function postBilling(path: string, body?: unknown): Promise<string> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  let data: BillingResponse = {};
  try {
    data = (await res.json()) as BillingResponse;
  } catch {
    /* no body */
  }
  if (!res.ok || !data.url) {
    throw new Error(data.error?.message ?? "Billing is not available right now. Try again in a moment.");
  }
  return data.url;
}

function useRedirectingPost() {
  const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const url = await postBilling(path, body);
      window.location.assign(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

/** POST /api/billing/checkout { plan } → Stripe Checkout. */
export function CheckoutButton({
  plan,
  children,
  variant = "default",
  size,
  className,
}: {
  plan: PaidPlanId;
  children?: React.ReactNode;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  const { busy, run } = useRedirectingPost();
  return (
    <Button type="button" variant={variant} size={size} className={className} disabled={busy} onClick={() => run("/api/billing/checkout", { plan })}>
      {children ?? "Upgrade"}
      <ArrowUpRight aria-hidden />
    </Button>
  );
}

/** POST /api/billing/portal → Stripe Customer Portal (plan changes, payment method, cancel). */
export function PortalButton({
  children = "Manage billing",
  variant = "outline",
  size,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  const { busy, run } = useRedirectingPost();
  return (
    <Button type="button" variant={variant} size={size} className={className} disabled={busy} onClick={() => run("/api/billing/portal")}>
      {children}
      <ExternalLink aria-hidden />
    </Button>
  );
}

const INITIAL: ActionState = { ok: false };

/** Team and above: the daily soft cap can be switched off. Submits on toggle. */
export function DailyCapForm({
  workspaceId,
  version,
  enabled,
  canDisable,
}: {
  workspaceId: string;
  version: number;
  enabled: boolean;
  canDisable: boolean;
}) {
  const [state, formAction, pending] = useActionState(setDailyCapAction, INITIAL);
  const formRef = React.useRef<HTMLFormElement>(null);
  const id = React.useId();
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="version" value={version} />
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={id}>Daily cap</Label>
          <p className="text-xs text-ink-3">
            {canDisable
              ? "On: at most one third of the month's credits per day. Off: spend them any day."
              : "One third of the month's credits per day. Turning it off is included in the Team plan and above."}
          </p>
        </div>
        <Switch
          id={id}
          name="daily_cap_enabled"
          value="on"
          defaultChecked={enabled}
          disabled={!canDisable || pending}
          onCheckedChange={() => {
            // Let Radix sync its hidden input before the form serialises.
            setTimeout(() => formRef.current?.requestSubmit(), 0);
          }}
          aria-label="Daily cap"
        />
      </div>
      <FormNotice state={state} />
    </form>
  );
}

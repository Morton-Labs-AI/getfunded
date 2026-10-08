import { can, planFor, type ResolvedPlan } from "@/lib/plans";

/**
 * Plan gates for outreach, pure. Drafting and recording by hand are on every
 * plan. Sending through a connected Gmail needs `send_gmail` (Pro and above,
 * or any self-hosted install).
 */

export type OutreachAbilities = {
  plan: ResolvedPlan;
  /** Write drafts, use templates, record letters and calls by hand. Always true. */
  draft: true;
  /** Polish a draft with the model (metered, 'draft' credits). True on every plan; the meter decides. */
  polish: true;
  /** Connect Gmail and send approved email. */
  sendGmail: boolean;
  /** Plain-language reason when sending is off. */
  sendGmailReason: string | null;
};

export function outreachAbilities(
  workspace: { plan?: string | null } | null | undefined,
  env: Record<string, string | undefined> = process.env,
): OutreachAbilities {
  const plan = planFor(workspace, null, env);
  const sendGmail = can(plan, "send_gmail");
  return {
    plan,
    draft: true,
    polish: true,
    sendGmail,
    sendGmailReason: sendGmail
      ? null
      : `Sending through your own Gmail is part of the Pro plan and above. Your workspace is on ${plan.name}. You can still write drafts here and send them yourself, then record them by hand.`,
  };
}

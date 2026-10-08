import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PLANS, formatPlanPrice, isSelfHosted, type PlanFeature } from "@/lib/plans";
import { lowestPlanWith, lowestPlanWithSeats } from "@/lib/settings/roles";
import { cn } from "@/lib/utils";

/**
 * Things a plan can unlock. `PlanFeature` values come from lib/plans.ts; the
 * extra keys cover limits that are counts rather than flags.
 */
export type UpgradeFeature = PlanFeature | "members" | "saved_funders" | "pipelines" | "export" | "daily_cap";

const COPY: Record<UpgradeFeature, { title: string; what: string }> = {
  nl_filter: { title: "Natural-language search", what: "Describe the funder you want in a sentence and get filters back." },
  ask: { title: "Ask the analyst", what: "Ask a question and get an answer backed by one read-only query." },
  fit: { title: "Fit analysis", what: "A scored, cited fit analysis for a funder." },
  research: { title: "Research dossier", what: "A sourced dossier built from web search." },
  draft: { title: "Draft polish", what: "Rewrite an outreach template with dossier facts only." },
  send_gmail: { title: "Send through Gmail", what: "Send approved messages from your own Gmail, one at a time." },
  api: { title: "Public API", what: "API keys for the /api/v1 endpoints: search, funders and saved lists." },
  sequences: { title: "Sequences", what: "Follow-up steps that stop as soon as a funder replies." },
  shared_knowledge: { title: "Shared knowledge base", what: "Approved facts and boilerplate the whole team can draft from." },
  dedicated_outreach: { title: "Dedicated outreach", what: "Managed campaigns, sender domains and deliverability monitoring." },
  reports: { title: "Reports", what: "Pipeline and funder reports you can share with your board." },
  members: { title: "More seats", what: "Invite more people to this workspace." },
  saved_funders: { title: "More saved funders", what: "Save more funders to your list." },
  pipelines: { title: "More pipelines", what: "Run more than one pipeline at a time." },
  export: { title: "Full export", what: "Export every row, not the first 100." },
  daily_cap: { title: "Daily cap off", what: "Spend the month's AI credits on any day you choose." },
};

function targetPlan(feature: UpgradeFeature, seats?: number) {
  switch (feature) {
    case "members":
      return lowestPlanWithSeats(seats ?? 2);
    case "saved_funders":
      return "pro";
    case "pipelines":
      return "pro";
    case "export":
      return "starter";
    case "daily_cap":
      return "team";
    default:
      return lowestPlanWith(feature);
  }
}

/**
 * The one way the app says "not on your plan". Honest and short: what the
 * feature is, the cheapest plan that includes it, and a link to Billing. Other
 * builders import this instead of writing their own upgrade copy.
 */
export function UpgradeNotice({
  feature,
  seats,
  compact = false,
  selfHosted,
  className,
}: {
  feature: UpgradeFeature;
  /** For `members`: how many seats you would need. */
  seats?: number;
  compact?: boolean;
  /** Pass from a Server Component when rendering inside a Client Component (env is not readable there). */
  selfHosted?: boolean;
  className?: string;
}) {
  if (selfHosted ?? isSelfHosted()) return null;
  const copy = COPY[feature];
  const planId = targetPlan(feature, seats);
  const plan = planId ? PLANS[planId] : null;
  const price = plan ? `${formatPlanPrice(plan)} per month` : null;

  return (
    <div
      data-slot="upgrade-notice"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-primary-border bg-primary-tint/60 text-sm text-ink-2",
        compact ? "p-3 sm:flex-row sm:items-center sm:justify-between" : "p-4",
        className,
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface text-primary">
          <Lock className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {copy.title}
            {plan ? (
              <span className="font-normal text-ink-3">
                {" "}
                is included in {plan.name}
                {price ? ` (${price})` : ""} and above.
              </span>
            ) : (
              <span className="font-normal text-ink-3"> is not available on this plan.</span>
            )}
          </p>
          {!compact ? <p className="mt-0.5 text-ink-3">{copy.what}</p> : null}
        </div>
      </div>
      <Button asChild size="sm" variant={compact ? "outline" : "default"} className="shrink-0 self-start sm:self-auto">
        <Link href="/app/settings/billing">
          See plans
          <ArrowUpRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatNumber } from "@/lib/format";
import type { UsageSummary } from "@/lib/billing/meter";
import { FEATURES, type Feature } from "@/lib/plans";

const FEATURE_LABELS: Record<Feature, string> = {
  filter: "Natural-language search filter",
  ask: "Ask the analyst (one question)",
  draft: "Outreach draft polish",
  fit: "Fit analysis (one funder)",
  research: "Research on the web (one funder)",
};

function Meter({
  label,
  used,
  limit,
  hint,
}: {
  label: string;
  used: number;
  limit: number | null;
  hint: string;
}) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const nearLimit = limit !== null && pct >= 90;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="tnum font-mono text-sm text-ink-2">
          {limit === null ? `${formatNumber(used)} used · unlimited` : `${formatNumber(used)} of ${formatNumber(limit)}`}
        </span>
      </div>
      {limit !== null ? (
        <Progress value={pct} aria-label={`${pct}% of ${label.toLowerCase()} used`} indicatorClassName={nearLimit ? "bg-warning" : undefined} />
      ) : null}
      <p className="text-xs text-ink-3">{hint}</p>
    </div>
  );
}

/**
 * The usage meter in full: this period, today, when it resets, and what each
 * feature costs. Pure presentation of `getUsage()`; no fetching here.
 */
export function UsageDetail({ usage, selfHosted = false }: { usage: UsageSummary; selfHosted?: boolean }) {
  const resetsOn = formatDate(usage.periodEnd, "long");
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI credits</CardTitle>
        <CardDescription>
          Search never uses credits. Only calls to a language model do.{" "}
          {usage.overridden ? "A steward granted this workspace a custom limit." : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Meter
          label="This period"
          used={usage.used}
          limit={usage.monthlyLimit}
          hint={
            usage.monthlyLimit === null
              ? selfHosted
                ? "Unlimited on this install. Usage is recorded so you can see what the AI costs you."
                : "No monthly limit on this plan."
              : `Resets on ${resetsOn}. ${usage.remaining === null ? "" : `${formatNumber(usage.remaining)} left.`}`
          }
        />
        <Meter
          label="Today"
          used={usage.usedToday}
          limit={usage.dailyLimit}
          hint={
            usage.dailyLimit === null
              ? "No daily cap."
              : `A daily cap of one third of the month spreads use out and limits damage from a runaway script. ${
                  usage.remainingToday === null ? "" : `${formatNumber(usage.remainingToday)} left today.`
                }`
          }
        />
        <div>
          <p className="eyebrow mb-2 text-muted-foreground">What a credit buys</p>
          <ul className="divide-y rounded-md border">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-ink-2">{FEATURE_LABELS[f]}</span>
                <span className="tnum font-mono text-foreground">
                  {usage.creditCosts[f]} {usage.creditCosts[f] === 1 ? "credit" : "credits"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

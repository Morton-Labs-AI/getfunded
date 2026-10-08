import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Activity, Building2, Sparkles, Users } from "lucide-react";

import { PageHeader, PlanBadge, Section, dayCaption, featureLabel } from "@/components/admin/bits";
import { BarChart, FunnelBars, StackedBars, chartColor } from "@/components/admin/charts";
import { Missing } from "@/components/data/missing";
import { StatTile } from "@/components/data/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSteward } from "@/lib/admin/gate";
import { dayWindow, getOverview, listStewards, pivotFeatures } from "@/lib/admin/queries";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PLANS, isPlanId } from "@/lib/plans";

export const metadata: Metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={null}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const session = await requireSteward();
  const [overview, stewards] = await Promise.all([getOverview(session.user.id), listStewards(session.user.id)]);
  const days = dayWindow(overview.windowDays);
  const credits = pivotFeatures(days, overview.creditsPerDay);
  const signupsLast7 = overview.signupsPerDay.slice(-7).reduce((a, b) => a + b.n, 0);

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            Accounts, plans and AI use across every workspace. Numbers are live as of{" "}
            <time dateTime={overview.generatedAt}>{formatDateTime(overview.generatedAt)}</time>. Customer content (saved
            funders, notes, messages) is never shown here.
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/usage">Usage and cost</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="People" value={formatNumber(overview.users)} hint={`${formatNumber(signupsLast7)} joined in the last 7 days`} icon={Users} />
        <StatTile label="Workspaces" value={formatNumber(overview.workspaces)} hint="Not counting deleted ones" icon={Building2} href="/admin/workspaces" />
        <StatTile label="Active workspaces" value={formatNumber(overview.activeWorkspaces7d)} hint="Used AI or recorded activity in 7 days" icon={Activity} />
        <StatTile
          label="AI credits"
          value={formatNumber(overview.credits30d)}
          hint={`${formatNumber(overview.calls30d)} model calls in ${overview.windowDays} days`}
          icon={Sparkles}
          href="/admin/usage"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Sign-ups per day" description={`People who created an account, last ${overview.windowDays} days (UTC).`}>
          <BarChart
            data={overview.signupsPerDay.map((d) => ({ label: d.day, value: d.n, caption: dayCaption(d.day) }))}
            ariaLabel="Sign-ups per day"
            showValues={false}
            labelEvery={5}
          />
        </Section>
        <Section title="AI credits per day by feature" description="Reserved and settled credits. Refunded calls are not counted.">
          <StackedBars
            labels={days.map(dayCaption)}
            series={credits.map((s, i) => ({ key: s.feature, label: featureLabel(s.feature), values: s.values, color: chartColor(i) }))}
            ariaLabel="AI credits per day by feature"
            labelEvery={5}
          />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Workspaces by plan" description="Live workspaces on each plan.">
          <FunnelBars
            data={overview.workspacesByPlan.map((r) => ({
              label: isPlanId(r.plan) ? PLANS[r.plan].name : r.plan,
              value: r.n,
              href: `/admin/workspaces?plan=${encodeURIComponent(r.plan)}`,
            }))}
            format={formatNumber}
          />
        </Section>
        <Section title="Stewards" description="People who can open these pages. Grant or remove access from a workspace page.">
          {stewards.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No account carries the steward flag yet. Your access comes from ADMIN_EMAILS until the flag is set.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {stewards.map((s) => (
                <li key={s.userId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{s.displayName ?? <Missing bare />}</span>{" "}
                    <span className="text-muted-foreground">{s.email}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {!s.listed ? (
                      <Badge
                        variant="outline"
                        title="This account has the steward flag in the database, but its email is not in the ADMIN_EMAILS environment variable. Removing the flag removes its access."
                      >
                        Flag only, not in ADMIN_EMAILS
                      </Badge>
                    ) : null}
                    {s.userId === session.user.id ? <PlanBadge plan="you" /> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

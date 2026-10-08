import type { Metadata } from "next";
import { Suspense } from "react";
import { Coins, Cpu, Sparkles, Undo2 } from "lucide-react";

import { LedgerStatus, PageHeader, PlanBadge, Section, dayCaption, featureLabel } from "@/components/admin/bits";
import { Donut, FunnelBars, StackedBars, chartColor } from "@/components/admin/charts";
import { Missing } from "@/components/data/missing";
import { StatTile } from "@/components/data/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PRICES_CHECKED, formatUsdCents, summarizeCost } from "@/lib/admin/cost";
import { requireSteward } from "@/lib/admin/gate";
import { getUsageReport, pivotFeatures } from "@/lib/admin/queries";
import { formatCompact, formatDateTime, formatNumber } from "@/lib/format";

export const metadata: Metadata = { title: "Usage and cost" };

export default function UsagePage() {
  return (
    <Suspense fallback={null}>
      <UsageContent />
    </Suspense>
  );
}

async function UsageContent() {
  const session = await requireSteward();
  const report = await getUsageReport(session.user.id);
  const series = pivotFeatures(report.days, report.creditsPerDay);
  const totalCredits = series.reduce((a, s) => a + s.total, 0);
  const cost = summarizeCost(
    report.modelTotals.map((m) => ({ model: m.model, inputTokens: m.inputTokens, outputTokens: m.outputTokens })),
  );
  const tokensIn = report.modelTotals.reduce((a, m) => a + m.inputTokens, 0);
  const tokensOut = report.modelTotals.reduce((a, m) => a + m.outputTokens, 0);
  const refunded = report.statusCounts.find((s) => s.status === "refunded")?.n ?? 0;
  const settled = report.statusCounts.find((s) => s.status === "settled")?.n ?? 0;

  return (
    <>
      <PageHeader
        title="Usage and cost"
        description={
          <>
            AI credits, model tokens and an estimated bill for the last {report.windowDays} days (UTC), as of{" "}
            <time dateTime={report.generatedAt}>{formatDateTime(report.generatedAt)}</time>.
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Credits used" value={formatNumber(totalCredits)} hint="Reserved and settled" icon={Sparkles} />
        <StatTile label="Tokens in / out" value={`${formatCompact(tokensIn)} / ${formatCompact(tokensOut)}`} hint={`${formatNumber(settled)} settled calls`} icon={Cpu} />
        <StatTile
          label="Estimated cost"
          value={cost.unknownModels.length > 0 && cost.cents === 0 ? <Missing bare /> : formatUsdCents(cost.cents)}
          hint={`List prices checked ${PRICES_CHECKED}; input and output tokens only`}
          icon={Coins}
        />
        <StatTile label="Refunded calls" value={formatNumber(refunded)} hint="Calls that failed and gave credits back" icon={Undo2} />
      </div>

      <Section title="Credits per day by feature" description="Which features spend the credits, day by day.">
        <StackedBars
          labels={report.days.map(dayCaption)}
          series={series.map((s, i) => ({ key: s.feature, label: featureLabel(s.feature), values: s.values, color: chartColor(i) }))}
          ariaLabel="Credits per day by feature"
          height={200}
          labelEvery={5}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Top workspaces" description="By credits in the window. Click through for the plan and override.">
          <FunnelBars
            data={report.topWorkspaces.map((w) => ({
              label: w.name,
              value: w.credits,
              note: `${formatNumber(w.calls)} calls`,
              href: `/admin/workspaces/${w.workspaceId}`,
            }))}
            format={formatNumber}
            labelWidth="10rem"
          />
        </Section>
        <Section title="Credits by feature" description="Share of the window's credits.">
          <Donut
            segments={series.filter((s) => s.total > 0).map((s, i) => ({ label: featureLabel(s.feature), value: s.total, color: chartColor(i) }))}
            centerValue={formatCompact(totalCredits)}
            centerLabel="credits"
            format={formatNumber}
            ariaLabel="Credits by feature"
          />
        </Section>
      </div>

      <Section
        title="Models and estimated cost"
        description="Settled calls grouped by model. Cost = input tokens × input price + output tokens × output price, from the constants in lib/admin/cost.ts."
        aside={cost.unknownModels.length > 0 ? `No price on file for: ${cost.unknownModels.join(", ")}` : undefined}
      >
        {report.modelTotals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settled model calls in this window.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">Tokens in</TableHead>
                <TableHead className="text-right">Tokens out</TableHead>
                <TableHead className="text-right">Avg latency</TableHead>
                <TableHead className="text-right">Est. cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.modelTotals.map((m, i) => {
                const est = cost.rows[i];
                return (
                  <TableRow key={m.model ?? "unknown"}>
                    <TableCell className="font-mono text-xs">{m.model ?? <Missing bare />}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(m.calls)}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(m.credits)}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(m.inputTokens)}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(m.outputTokens)}</TableCell>
                    <TableCell className="tnum text-right">{m.avgLatencyMs === null ? <Missing bare /> : `${formatNumber(m.avgLatencyMs)} ms`}</TableCell>
                    <TableCell className="tnum text-right">{est?.known ? formatUsdCents(est.cents) : <Missing bare />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Ledger status" description="Every ledger row in the window by status.">
        <ul className="flex flex-wrap gap-4 text-sm">
          {report.statusCounts.length === 0 ? <li className="text-muted-foreground">No rows.</li> : null}
          {report.statusCounts.map((s) => (
            <li key={s.status} className="inline-flex items-center gap-2">
              <LedgerStatus status={s.status} />
              <span className="tnum font-medium">{formatNumber(s.n)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Plans in this window: {report.topWorkspaces.length === 0 ? "none" : null}
          {Array.from(new Set(report.topWorkspaces.map((w) => w.plan))).map((p) => (
            <span key={p} className="mr-1 inline-block">
              <PlanBadge plan={p} />
            </span>
          ))}
        </p>
      </Section>
    </>
  );
}

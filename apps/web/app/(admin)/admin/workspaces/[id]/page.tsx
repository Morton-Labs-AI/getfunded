import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { LedgerStatus, PageHeader, PlanBadge, Section, SubscriptionStatus, featureLabel } from "@/components/admin/bits";
import { PlanOverrideForm } from "@/components/admin/plan-override-form";
import { StewardToggle } from "@/components/admin/steward-toggle";
import { Missing } from "@/components/data/missing";
import { StatTile } from "@/components/data/stat-tile";
import { YoursTag } from "@/components/data/yours-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSteward } from "@/lib/admin/gate";
import { getWorkspaceDetail } from "@/lib/admin/queries";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { PLANS, isPlanId } from "@/lib/plans";

export const metadata: Metadata = { title: "Workspace" };

type Params = Promise<{ id: string }>;

export default function WorkspacePage({ params }: { params: Params }) {
  return (
    <Suspense fallback={null}>
      <WorkspaceContent params={params} />
    </Suspense>
  );
}

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

async function WorkspaceContent({ params }: { params: Params }) {
  const session = await requireSteward();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ws = await getWorkspaceDetail(session.user.id, id);
  if (!ws) notFound();

  const planDef = PLANS[isPlanId(ws.plan) ? ws.plan : "free"];
  const usage = ws.usage;

  return (
    <>
      <PageHeader
        title={ws.name}
        description={
          <>
            <span className="font-mono text-xs">{ws.slug}</span> · created <time dateTime={ws.createdAt}>{formatDate(ws.createdAt)}</time>
            {ws.deletedAt ? (
              <>
                {" "}
                · <Badge variant="danger">Deleted {formatDate(ws.deletedAt)}</Badge>
              </>
            ) : null}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/workspaces">All workspaces</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Plan"
          value={<span className="text-xl">{planDef.name}</span>}
          hint={
            usage?.overridden ? (
              <YoursTag label="Override applied" />
            ) : ws.subscription ? (
              <SubscriptionStatus status={ws.subscription.status} />
            ) : (
              "No subscription"
            )
          }
        />
        <StatTile
          label="Credits this period"
          value={usage ? formatNumber(usage.used) : <Missing bare />}
          hint={
            usage
              ? usage.monthlyLimit === null
                ? "No monthly limit"
                : `of ${formatNumber(usage.monthlyLimit)} · resets ${formatDate(usage.periodEnd)}`
              : "Not available"
          }
        />
        <StatTile
          label="Credits today"
          value={usage ? formatNumber(usage.usedToday) : <Missing bare />}
          hint={usage ? (usage.dailyLimit === null ? "No daily cap" : `of ${formatNumber(usage.dailyLimit)} daily cap`) : "Not available"}
        />
        <StatTile label="Members" value={formatNumber(ws.members.length)} hint={planDef.members === null ? "No seat limit" : `${formatNumber(planDef.members)} seats on ${planDef.name}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Section title="Members" description="Steward access is per person, not per workspace. A steward can read accounts, plans and usage across the service.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Steward</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ws.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="max-w-[16rem]">
                    <span className="block truncate font-medium">{m.displayName ?? <Missing bare />}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                  </TableCell>
                  <TableCell>{ROLE_LABELS[m.role] ?? m.role}</TableCell>
                  <TableCell>{m.lastSeenAt ? <time dateTime={m.lastSeenAt}>{formatDateTime(m.lastSeenAt)}</time> : <Missing bare />}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {m.isSteward ? <Badge variant="outline">Steward</Badge> : null}
                      <StewardToggle userId={m.userId} isSteward={m.isSteward} isSelf={m.userId === session.user.id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="Plan override" description="A steward-granted exception, for pilot nonprofits and partners. The plan itself stays as billed.">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <PlanBadge plan={ws.plan} />
            {ws.subscription ? (
              <span className="text-muted-foreground">
                Subscription {ws.subscription.plan} · {ws.subscription.cancelAtPeriodEnd ? "ends" : "renews"}{" "}
                {ws.subscription.currentPeriodEnd ? formatDate(ws.subscription.currentPeriodEnd) : <Missing bare />}
              </span>
            ) : null}
            {ws.override ? (
              <span className="text-xs text-muted-foreground">
                Override updated {ws.override.updatedAt ? formatDateTime(ws.override.updatedAt) : ""}
              </span>
            ) : null}
          </div>
          <PlanOverrideForm
            workspaceId={ws.id}
            planName={planDef.name}
            override={ws.override ? { monthlyCredits: ws.override.monthlyCredits, members: ws.override.members, note: ws.override.note } : null}
            defaults={{ monthly_credits: planDef.monthly_credits, members: planDef.members }}
          />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Section title="About this workspace" description="From the organization profile the fit engine reads. Contact details and content are not shown.">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Mission</dt>
            <dd className="line-clamp-4">{ws.profileSummary.mission ?? <Missing />}</dd>
            <dt className="text-muted-foreground">State</dt>
            <dd>{ws.profileSummary.state ?? <Missing />}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="truncate">{ws.profileSummary.website ?? <Missing />}</dd>
            <dt className="text-muted-foreground">API keys</dt>
            <dd className="tnum">{formatNumber(ws.apiKeys)} active</dd>
            <dt className="text-muted-foreground">Billing day</dt>
            <dd className="tnum">Day {ws.billingAnchorDay} of the month</dd>
            <dt className="text-muted-foreground">Stripe customer</dt>
            <dd className="font-mono text-xs">{ws.stripeCustomerId ?? <Missing />}</dd>
          </dl>
        </Section>

        <Section title="Recent AI calls" description="The last 20 ledger rows. Token counts are real; a reserved row is a call still running or one whose settle failed.">
          {ws.recentLedger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No AI calls yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Feature</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tokens in / out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ws.recentLedger.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <time dateTime={l.createdAt}>{formatDateTime(l.createdAt)}</time>
                      {l.userEmail ? <span className="block truncate text-xs text-muted-foreground">{l.userEmail}</span> : null}
                    </TableCell>
                    <TableCell>{featureLabel(l.feature)}</TableCell>
                    <TableCell className="tnum text-right">{formatNumber(l.credits)}</TableCell>
                    <TableCell>
                      <LedgerStatus status={l.status} />
                    </TableCell>
                    <TableCell className="tnum text-right font-mono text-xs">
                      {l.inputTokens === null && l.outputTokens === null ? (
                        <Missing bare />
                      ) : (
                        `${formatNumber(l.inputTokens)} / ${formatNumber(l.outputTokens)}`
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </>
  );
}

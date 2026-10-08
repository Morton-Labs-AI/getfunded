import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Search } from "lucide-react";

import { PageHeader, PlanBadge, SubscriptionStatus } from "@/components/admin/bits";
import { Missing } from "@/components/data/missing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSteward } from "@/lib/admin/gate";
import { listWorkspaces } from "@/lib/admin/queries";
import { firstParam } from "@/lib/auth/next-path";
import { formatDate, formatNumber } from "@/lib/format";
import { PLAN_IDS, PLANS } from "@/lib/plans";

export const metadata: Metadata = { title: "Workspaces" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function WorkspacesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <WorkspacesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function WorkspacesContent({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSteward();
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").slice(0, 120);
  const planRaw = firstParam(params.plan) ?? "";
  const plan = (PLAN_IDS as readonly string[]).includes(planRaw) ? planRaw : "";
  const page = Math.max(1, Number(firstParam(params.page)) || 1);
  const list = await listWorkspaces(session.user.id, { q, plan, page });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (plan) sp.set("plan", plan);
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return `/admin/workspaces${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Workspaces" description="Every live workspace, its plan, and the AI credits it has used this billing period." />

      <form method="get" action="/admin/workspaces" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="q">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="q" name="q" type="search" defaultValue={q} placeholder="Workspace name, slug, or a member's email" className="pl-9" autoComplete="off" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="plan">Plan</Label>
          <select
            id="plan"
            name="plan"
            defaultValue={plan}
            className="flex h-9 w-full min-w-40 rounded-md border border-input bg-surface px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="">Any plan</option>
            {PLAN_IDS.map((id) => (
              <option key={id} value={id}>
                {PLANS[id].name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {list.total === 0
          ? "No workspaces match."
          : `${formatNumber(list.total)} workspace${list.total === 1 ? "" : "s"}${q || plan ? " match" : ""}. Page ${list.page} of ${pages}.`}
      </p>

      {list.rows.length > 0 ? (
        <div className="rounded-lg border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Credits this period</TableHead>
                <TableHead>Override</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="max-w-[18rem]">
                    <Link href={`/admin/workspaces/${w.id}`} className="block truncate font-medium hover:underline">
                      {w.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {w.slug}
                      {w.ownerEmail ? ` · ${w.ownerEmail}` : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <PlanBadge plan={w.plan} />
                  </TableCell>
                  <TableCell>
                    <SubscriptionStatus status={w.subscriptionStatus} />
                  </TableCell>
                  <TableCell className="tnum text-right">{formatNumber(w.memberCount)}</TableCell>
                  <TableCell className="tnum text-right">{formatNumber(w.creditsUsed)}</TableCell>
                  <TableCell>
                    {w.overrideMonthlyCredits !== null || w.overrideMembers !== null ? (
                      <Badge variant="yours">
                        {w.overrideMonthlyCredits !== null ? `${formatNumber(w.overrideMonthlyCredits)} credits` : ""}
                        {w.overrideMonthlyCredits !== null && w.overrideMembers !== null ? " · " : ""}
                        {w.overrideMembers !== null ? `${formatNumber(w.overrideMembers)} members` : ""}
                      </Badge>
                    ) : (
                      <Missing bare />
                    )}
                  </TableCell>
                  <TableCell>
                    <time dateTime={w.createdAt}>{formatDate(w.createdAt)}</time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Pages">
          <Button asChild variant="outline" size="sm" disabled={list.page <= 1}>
            {list.page > 1 ? <Link href={href(list.page - 1)}>Previous</Link> : <span aria-disabled="true">Previous</span>}
          </Button>
          <span className="tnum text-sm text-muted-foreground">
            Page {list.page} of {pages}
          </span>
          <Button asChild variant="outline" size="sm">
            {list.page < pages ? <Link href={href(list.page + 1)}>Next</Link> : <span aria-disabled="true">Next</span>}
          </Button>
        </nav>
      ) : null}
    </>
  );
}

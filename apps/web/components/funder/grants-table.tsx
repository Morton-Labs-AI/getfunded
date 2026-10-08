import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GRANTS_AS_REPORTED_NOTE, GRANTS_EMPTY_NOTE, GRANTS_PAID_TITLE } from "@/lib/content/copy";
import { formatNumber } from "@/lib/format";
import type { GrantsPage } from "@/lib/queries/corpus/types";
import { cn } from "@/lib/utils";

import { ProfileSection } from "./profile-section";
import { SourceWithSeal } from "./provenance";

/** Zero-JS: a GET form for the filter and links for the pages. */
export function GrantsTable({ grants, basePath, funderBase }: { grants: GrantsPage; basePath: string; funderBase: string }) {
  const href = (page: number) => {
    const sp = new URLSearchParams();
    if (grants.q) sp.set("gq", grants.q);
    if (page > 1) sp.set("gpage", String(page));
    const s = sp.toString();
    return `${basePath}${s ? `?${s}` : ""}#grants`;
  };
  const disabled = "pointer-events-none opacity-50";

  return (
    <ProfileSection
      id="grants"
      title={GRANTS_PAID_TITLE}
      aside={grants.total > 0 ? <span className="tnum text-xs text-ink-3">{formatNumber(grants.total)} on file</span> : undefined}
      note={grants.total > 0 ? GRANTS_AS_REPORTED_NOTE : undefined}
    >
      <form method="get" action={basePath} className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Label htmlFor="grants-q" className="sr-only">
          Search recipients and purposes
        </Label>
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="grants-q" name="gq" type="search" defaultValue={grants.q ?? ""} placeholder="Search recipients and purposes" className="h-9 pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" className="h-9">
            Filter
          </Button>
          {grants.q ? (
            <Link href={`${basePath}#grants`} className="text-sm text-ink-3 hover:text-foreground">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {grants.rows.length === 0 ? (
        <p className="text-sm text-ink-2">{grants.q ? "No grant rows match that filter." : GRANTS_EMPTY_NOTE}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.rows.map((g) => (
                <TableRow key={g.id} className="align-top">
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    {g.recipientOrgId ? (
                      <Link href={`${funderBase}/${g.recipientOrgId}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {g.recipientName ?? <Missing bare />}
                      </Link>
                    ) : (
                      <span className="text-foreground" title="As reported on the filing; not matched to an organization record">
                        {g.recipientName ?? <Missing bare />}
                      </span>
                    )}
                    {g.recipientCity || g.recipientState ? (
                      <span className="block text-xs text-ink-3">{[g.recipientCity, g.recipientState].filter(Boolean).join(", ")}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[22rem] whitespace-normal text-ink-2">{g.purpose ?? <Missing bare />}</TableCell>
                  <TableCell className="text-right">
                    <Money value={g.amount} />
                  </TableCell>
                  <TableCell className="tnum">{g.fiscalYear ?? <Missing bare />}</TableCell>
                  <TableCell>
                    <SourceWithSeal label={g.fiscalYear ? `FY${g.fiscalYear}` : g.provenance.source} p={g.provenance} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {grants.pageCount > 1 ? (
            <nav aria-label="Grant pages" className="mt-3 flex items-center justify-between gap-3">
              <Link
                href={href(grants.page - 1)}
                aria-disabled={grants.page <= 1}
                tabIndex={grants.page <= 1 ? -1 : undefined}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), grants.page <= 1 && disabled)}
              >
                <ChevronLeft aria-hidden />
                Previous
              </Link>
              <span className="tnum text-sm text-ink-3">
                Page {grants.page} of {grants.pageCount}
              </span>
              <Link
                href={href(grants.page + 1)}
                aria-disabled={grants.page >= grants.pageCount}
                tabIndex={grants.page >= grants.pageCount ? -1 : undefined}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), grants.page >= grants.pageCount && disabled)}
              >
                Next
                <ChevronRight aria-hidden />
              </Link>
            </nav>
          ) : null}
        </>
      )}
    </ProfileSection>
  );
}

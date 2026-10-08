import Link from "next/link";

import { Missing } from "@/components/data/missing";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatEin } from "@/lib/format";
import { MATCH_STATUS_LABELS, isAdded, type MatchStatus } from "@/lib/workspace/import-match";
import type { ImportReport as Report } from "@/lib/workspace/imports";

const TONE: Record<MatchStatus, "success" | "secondary" | "warning" | "outline" | "danger"> = {
  matched_ein: "success",
  matched_name: "success",
  already_saved: "secondary",
  ambiguous: "warning",
  unmatched: "outline",
  empty: "outline",
  limit_reached: "danger",
};

/** Every row of an import, with what happened and why. Nothing was merged on a guess. */
export function ImportReportTable({ report }: { report: Report }) {
  return (
    <div className="rounded-lg border bg-card shadow-card">
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Row</TableHead>
            <TableHead>In your file</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Matched or possible organizations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((r) => (
            <TableRow key={r.rowNumber} className="align-top">
              <TableCell className="tnum text-ink-3">{r.rowNumber}</TableCell>
              <TableCell className="max-w-[18rem] whitespace-normal">
                <p className="text-sm font-medium text-foreground">{r.name ?? <Missing bare />}</p>
                <p className="tnum font-mono text-xs text-ink-3">{r.ein ? formatEin(r.ein) : ""}</p>
                {r.notes ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{r.notes}</p> : null}
              </TableCell>
              <TableCell className="max-w-[16rem] whitespace-normal">
                <Badge variant={TONE[r.status]}>{MATCH_STATUS_LABELS[r.status]}</Badge>
                <p className="mt-1 text-xs leading-5 text-ink-3">{r.reason}</p>
              </TableCell>
              <TableCell className="max-w-[20rem] whitespace-normal">
                {r.candidates.length === 0 ? (
                  <span className="text-xs text-ink-4">None</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {r.candidates.map((c) => (
                      <li key={c.orgId} className="text-xs">
                        <Link href={`/app/funders/${c.orgId}`} className="font-medium text-primary hover:underline">
                          {c.name}
                        </Link>
                        <span className="text-ink-3">
                          {" "}
                          {[c.city, c.state].filter(Boolean).join(", ")}
                          {c.ein ? ` · ${formatEin(c.ein)}` : ""}
                        </span>
                        {isAdded(r.status) || r.status === "already_saved" ? null : <span className="text-ink-4"> · open to save by hand</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import Link from "next/link";
import { Building2, Database, FileCheck } from "lucide-react";

import { POSTURE_LABELS } from "@/components/data/posture";
import { StatTile } from "@/components/data/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCompact, formatDate, formatNumber } from "@/lib/format";

import { getCorpusStats, orgTypeLabel, type CorpusStats } from "./corpus-stats";

/** "Refreshed Aug 12, 2026" or nothing. */
function Refreshed({ stats }: { stats: CorpusStats }) {
  if (!stats.refreshedAt) return null;
  return (
    <span>
      Database refreshed <time dateTime={stats.refreshedAt}>{formatDate(stats.refreshedAt)}</time>
    </span>
  );
}

/**
 * Three proof points on the landing page, live from the corpus. When the
 * database cannot be reached the tiles are replaced by plain words with no
 * numbers in them: we never show a stale or made-up count.
 */
export async function ProofPoints() {
  const stats = await getCorpusStats();

  if (!stats || (stats.orgs === null && stats.events === null && stats.posture.open === null)) {
    return (
      <div className="rounded-lg border bg-card p-5 shadow-card">
        <p className="eyebrow text-muted-foreground">What the database holds</p>
        <ul className="mt-3 grid gap-3 text-sm text-ink-2 sm:grid-cols-3">
          <li className="flex gap-2">
            <Building2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            Every U.S. exempt organization in the IRS master file, plus SEC-registered advisers, funds and companies.
          </li>
          <li className="flex gap-2">
            <Database className="mt-0.5 size-4 shrink-0 text-source" aria-hidden />
            Grants, awards and offerings from public filings, each pointing at the file it came from.
          </li>
          <li className="flex gap-2">
            <FileCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            Whether each foundation says it accepts applications, from its latest Form 990-PF.
          </li>
        </ul>
        <p className="mt-3 text-xs text-ink-3">
          Live counts are not available right now. The <Link href="/data" className="underline underline-offset-4">data page</Link>{" "}
          lists every source.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Organizations"
          value={formatCompact(stats.orgs)}
          hint="IRS master file plus SEC advisers, funds and companies"
          icon={Building2}
          href="/data"
        />
        <StatTile
          label="Funding events"
          value={formatCompact(stats.events)}
          hint="Grants, awards and offerings, each with a source file"
          icon={Database}
          href="/data"
        />
        <StatTile
          label="Foundations that accept applications"
          value={formatNumber(stats.posture.open)}
          hint="As stated on each foundation's latest Form 990-PF"
          icon={FileCheck}
          href="/search"
        />
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        <span>Live from the database.</span>
        <Refreshed stats={stats} />
        <Link href="/data" className="underline underline-offset-4 hover:text-foreground">
          Sources and known limits
        </Link>
      </p>
    </div>
  );
}

/** Coverage numbers for the /data page. */
export async function CoverageTable() {
  const stats = await getCorpusStats();

  if (!stats) {
    return (
      <div className="rounded-lg border bg-card p-5 text-sm text-ink-2 shadow-card">
        <p>Live counts are not available right now. The database was not reachable when this page was built.</p>
        <p className="mt-2 text-ink-3">
          The sources table below is still accurate; it describes what the pipeline loads, not a count.
        </p>
      </div>
    );
  }

  const postureRows = (["open", "preselected_only", "unknown"] as const).map((key) => ({
    key,
    label: POSTURE_LABELS[key === "preselected_only" ? "preselected" : key],
    n: stats.posture[key],
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-lg border bg-card shadow-card">
        <div className="border-b px-4 py-3">
          <h3 className="font-semibold text-foreground">Organizations by type</h3>
          <p className="text-xs text-ink-3">
            {formatNumber(stats.orgs)} in total. <Refreshed stats={stats} />
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.orgTypes.map((row) => (
              <TableRow key={row.orgType}>
                <TableCell className="whitespace-normal">{orgTypeLabel(row.orgType)}</TableCell>
                <TableCell className="text-right font-mono">{formatNumber(row.n)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-6">
        <div className="rounded-lg border bg-card shadow-card">
          <div className="border-b px-4 py-3">
            <h3 className="font-semibold text-foreground">Do foundations accept applications?</h3>
            <p className="text-xs text-ink-3">What each private foundation says on its latest Form 990-PF.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What the filing says</TableHead>
                <TableHead className="text-right">Foundations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {postureRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="whitespace-normal">{row.label}</TableCell>
                  <TableCell className="text-right font-mono">{formatNumber(row.n)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-4 py-3 text-xs text-ink-3">
            &ldquo;Not stated in filings&rdquo; is the absence of a statement, not a closed door. Public charities file a form with no
            application section, so they are not in this table at all.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Funding events" value={formatCompact(stats.events)} hint="Grants, commitments, awards, offerings" />
          <StatTile
            label="Public contact channels"
            value={formatNumber(stats.publicContacts)}
            hint="Shared inboxes and office phone numbers the filing lets us publish"
          />
        </div>
      </div>
    </div>
  );
}

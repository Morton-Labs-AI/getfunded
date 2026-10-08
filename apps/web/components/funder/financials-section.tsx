import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { StatTile } from "@/components/data/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AMENDED_RULE_NOTE,
  BMF_SNAPSHOT_NOTE,
  DISTRIBUTIONS_NOTE,
  EXPENSE_SPLIT_NOTE,
  FILING_AS_FILED_NOTE,
  NO_FINANCIALS_NOTE,
} from "@/lib/content/copy";
import { filingSourceLabel, returnTypeLabel } from "@/lib/content/labels";
import { toNumber } from "@/lib/format";
import { positive } from "@/lib/queries/corpus/safe";
import type { FinancialYear, FunderRecord } from "@/lib/queries/corpus/types";

import { FyBars, SplitBar, type SplitSegment } from "./fy-bars";
import { ProfileSection } from "./profile-section";
import { SourceWithSeal } from "./provenance";

function num(v: string | null): number | null {
  return toNumber(v);
}

export function FinancialsSection({ funder, years }: { funder: FunderRecord; years: FinancialYear[] }) {
  const latest = years.length > 0 ? years[years.length - 1] : null;
  const fyLabel = latest ? filingSourceLabel(latest.returnType, latest.fy) : null;

  if (!latest) {
    const bmf = funder.bmf;
    const hasBmf = positive(bmf.assets) || positive(bmf.income) || positive(bmf.revenue);
    return (
      <ProfileSection id="financials" title="Financials" note={hasBmf ? BMF_SNAPSHOT_NOTE : undefined}>
        {hasBmf ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Assets" value={positive(bmf.assets) ? <Money value={bmf.assets} compact /> : null} hint="IRS master file" />
            <StatTile label="Income" value={positive(bmf.income) ? <Money value={bmf.income} compact /> : null} hint="IRS master file" />
            <StatTile label="Revenue" value={positive(bmf.revenue) ? <Money value={bmf.revenue} compact /> : null} hint="IRS master file" />
          </div>
        ) : (
          <p className="text-sm">
            <Missing kind="no-public-data" />
          </p>
        )}
        <p className="mt-3 text-sm text-ink-2">{NO_FINANCIALS_NOTE}</p>
      </ProfileSection>
    );
  }

  const isCharity = latest.programServices !== null;
  const giving = latest.giving ?? latest.contributionsPaid ?? latest.totalGrantsPaid;
  const seriesGiving = years.map((y) => ({ label: `FY${y.fy ?? "?"}`, caption: y.fy ? `'${String(y.fy).slice(2)}` : "?", value: num(y.giving ?? y.contributionsPaid) }));
  const seriesAssets = years.map((y) => ({ label: `FY${y.fy ?? "?"}`, caption: y.fy ? `'${String(y.fy).slice(2)}` : "?", value: num(y.assets ?? y.fmvAssets) }));

  // A null line stays null: the bar leaves it out and the legend says "not available", never 0%.
  const splitSegments: SplitSegment[] | null = isCharity
    ? [
        { label: "Program services", value: num(latest.programServices), color: "var(--chart-1)" },
        { label: "Management and general", value: num(latest.management), color: "var(--chart-3)" },
        { label: "Fundraising", value: num(latest.fundraising), color: "var(--chart-4)" },
      ]
    : null;

  return (
    <ProfileSection
      id="financials"
      title="Financials"
      aside={<SourceWithSeal label={fyLabel ?? "IRS e-file"} p={latest.provenance} />}
      note={
        <>
          {FILING_AS_FILED_NOTE} {AMENDED_RULE_NOTE} {DISTRIBUTIONS_NOTE}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={isCharity ? "Grants paid" : "Giving"}
          value={giving !== null ? <Money value={giving} compact /> : null}
          hint={`FY${latest.fy ?? "?"} · ${isCharity ? "grants and similar amounts paid" : "qualifying distributions"}`}
        />
        <StatTile label="Total assets" value={latest.assets !== null ? <Money value={latest.assets} compact /> : null} hint={`FY${latest.fy ?? "?"} · end of year`} />
        <StatTile label="Revenue" value={latest.revenue !== null ? <Money value={latest.revenue} compact /> : null} hint={`FY${latest.fy ?? "?"}`} />
        <StatTile label="Expenses" value={latest.expenses !== null ? <Money value={latest.expenses} compact /> : null} hint={`FY${latest.fy ?? "?"}`} />
      </div>

      {years.length > 1 ? (
        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <p className="eyebrow mb-2 text-muted-foreground">{isCharity ? "Grants paid by year" : "Giving by year"}</p>
            <FyBars data={seriesGiving} ariaLabel={isCharity ? "Grants paid by fiscal year" : "Giving by fiscal year"} />
          </div>
          <div>
            <p className="eyebrow mb-2 text-muted-foreground">Total assets by year</p>
            <FyBars data={seriesAssets} color="var(--chart-2)" ariaLabel="Total assets by fiscal year" />
          </div>
        </div>
      ) : null}

      {splitSegments ? (
        <div className="mt-5">
          <p className="eyebrow mb-2 text-muted-foreground">Where the money went · FY{latest.fy ?? "?"}</p>
          <SplitBar segments={splitSegments} ariaLabel={`Expense split for FY${latest.fy ?? "?"}`} />
          <p className="mt-2 text-xs text-ink-3">{EXPENSE_SPLIT_NOTE}</p>
        </div>
      ) : null}

      <div className="mt-5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead>Form</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Expenses</TableHead>
              <TableHead className="text-right">{isCharity ? "Grants paid" : "Giving"}</TableHead>
              <TableHead className="text-right">Assets</TableHead>
              <TableHead className="text-right">Net assets</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...years].reverse().map((y) => (
              <TableRow key={y.objectId}>
                <TableCell className="tnum font-medium">
                  FY{y.fy ?? "?"}
                  {y.amended ? <span className="ml-1.5 text-xs text-ink-3">amended</span> : null}
                </TableCell>
                <TableCell className="text-ink-3">{returnTypeLabel(y.returnType)}</TableCell>
                <TableCell className="text-right">
                  <Money value={y.revenue} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={y.expenses} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={y.giving ?? y.contributionsPaid} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={y.assets} />
                </TableCell>
                <TableCell className="text-right">
                  <Money value={y.netAssets} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ProfileSection>
  );
}

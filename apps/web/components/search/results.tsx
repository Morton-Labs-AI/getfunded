import * as React from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { IrsStandingChip } from "@/components/data/irs-standing-chip";
import { Missing } from "@/components/data/missing";
import { Money } from "@/components/data/money";
import { Posture } from "@/components/data/posture";
import { SourceChip } from "@/components/data/source-chip";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IRS_MASTER_FILE_FULL_NAME, IRS_MASTER_FILE_LABEL } from "@/lib/content/copy";
import { formatEin, formatMoneyCompact, formatNumber } from "@/lib/format";
import type { SearchHit } from "@/lib/queries/corpus/types";

export type RenderSave = (hit: SearchHit) => React.ReactNode;

function location(hit: SearchHit): string | null {
  if (hit.city && hit.state) return `${hit.city}, ${hit.state}`;
  return hit.state ?? hit.city ?? null;
}

/**
 * The IRS standing chip on a result, only when the IRS automatically revoked
 * the organization. Every other standing is on the funder's own page; a row of
 * "on the IRS list" chips would be noise, and "on no list" is an absence, not
 * a finding. The chip opens the IRS's dated statement.
 */
function RevokedChip({ hit }: { hit: SearchHit }) {
  if (hit.irsStanding?.standing !== "revoked") return null;
  return <IrsStandingChip standing={hit.irsStanding} compact />;
}

function GivingLine({ hit }: { hit: SearchHit }) {
  const parts: React.ReactNode[] = [];
  if (hit.distributions) {
    parts.push(
      <span key="d">
        Gives <Money value={hit.distributions} compact className="font-semibold text-foreground" />
        {hit.filing ? <span className="text-ink-4"> a year (FY{hit.filing.fy})</span> : <span className="text-ink-4"> a year</span>}
      </span>,
    );
  }
  if (hit.assets) {
    parts.push(
      <span key="a">
        Assets <Money value={hit.assets} compact className="font-semibold text-foreground" />
        {hit.assetsSource === "bmf" ? (
          <span className="text-ink-4">
            {" "}
            (<abbr title={IRS_MASTER_FILE_FULL_NAME} className="no-underline">{IRS_MASTER_FILE_LABEL}</abbr>)
          </span>
        ) : null}
      </span>,
    );
  }
  if (hit.grantsOnFile && hit.grantsOnFile > 0) {
    parts.push(
      <span key="g">
        {formatNumber(hit.grantsOnFile)} grants on file
        {hit.grantsTotal ? ` · ${formatMoneyCompact(hit.grantsTotal)} total` : ""}
      </span>,
    );
  }
  if (parts.length === 0) return <Missing />;
  return (
    <p className="text-[13px] text-ink-3">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="mx-1.5 text-ink-4">·</span> : null}
          {part}
        </React.Fragment>
      ))}
    </p>
  );
}

function MatchLine({ hit }: { hit: SearchHit }) {
  const { reason, snippet, givingTo } = hit.match;
  if (!reason && !snippet && !givingTo) return null;
  return (
    <div className="space-y-1.5 text-[12.5px]">
      {reason ? <p className="text-ink-3">{reason}</p> : null}
      {snippet ? <p className="line-clamp-2 text-ink-2">{snippet}</p> : null}
      {givingTo ? (
        <p className="border-l-[3px] border-source bg-source-tint/50 py-1 pl-2.5 text-ink-2">
          <span className="font-medium">
            {formatNumber(givingTo.n)} matching grant{givingTo.n === 1 ? "" : "s"}
            {givingTo.total ? ` · ${formatMoneyCompact(givingTo.total)}` : ""}
          </span>
          {givingTo.samples.length > 0 ? <span className="text-ink-3"> — {givingTo.samples.join("; ")}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

function ProgramAreas({ hit }: { hit: SearchHit }) {
  if (hit.programAreas.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Program areas">
      {hit.programAreas.map((area) => (
        <li key={area}>
          <Badge variant="secondary">{area}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function ResultCards({ hits, funderBase, renderSave }: { hits: SearchHit[]; funderBase: string; renderSave?: RenderSave }) {
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {hits.map((hit) => {
        const loc = location(hit);
        return (
          <li key={hit.orgId} className="flex flex-col gap-2.5 rounded-lg border bg-card p-4 text-card-foreground shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`${funderBase}/${hit.orgId}`} className="text-[15px] font-semibold text-foreground hover:text-primary hover:underline">
                  {hit.name}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
                  <span>{hit.orgTypeLabel}</span>
                  {loc ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden />
                      {loc}
                    </span>
                  ) : null}
                  {hit.ein ? <span className="tnum font-mono">EIN {formatEin(hit.ein)}</span> : null}
                </p>
              </div>
              {renderSave ? <div className="shrink-0">{renderSave(hit)}</div> : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <GivingLine hit={hit} />
              <span className="flex flex-wrap items-center gap-2">
                <RevokedChip hit={hit} />
                <Posture value={hit.posture ?? "unknown"} />
              </span>
            </div>
            <ProgramAreas hit={hit} />
            <MatchLine hit={hit} />
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <SourceChip label={hit.sourceLabel} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ResultsTable({ hits, funderBase, renderSave }: { hits: SearchHit[]; funderBase: string; renderSave?: RenderSave }) {
  return (
    <div className="rounded-lg border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Funder</TableHead>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">Gives / year</TableHead>
            <TableHead className="text-right">Assets</TableHead>
            <TableHead>Applications</TableHead>
            <TableHead>Source</TableHead>
            {renderSave ? <TableHead className="sr-only">Save</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {hits.map((hit) => (
            <TableRow key={hit.orgId}>
              <TableCell className="max-w-[24rem] whitespace-normal">
                <Link href={`${funderBase}/${hit.orgId}`} className="font-medium text-foreground hover:text-primary hover:underline">
                  {hit.name}
                </Link>
                <span className="ml-2 text-xs text-ink-4">{hit.orgTypeLabel}</span>
                {hit.match.givingTo ? (
                  <span className="mt-0.5 block text-xs text-ink-3">
                    {formatNumber(hit.match.givingTo.n)} matching grant{hit.match.givingTo.n === 1 ? "" : "s"}
                    {hit.match.givingTo.total ? ` · ${formatMoneyCompact(hit.match.givingTo.total)}` : ""}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-ink-3">{location(hit) ?? <Missing bare />}</TableCell>
              <TableCell className="text-right">
                <Money value={hit.distributions} compact />
              </TableCell>
              <TableCell className="text-right">
                <Money value={hit.assets} compact />
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Posture value={hit.posture ?? "unknown"} />
                  <RevokedChip hit={hit} />
                </span>
              </TableCell>
              <TableCell>
                <SourceChip label={hit.sourceLabel} />
              </TableCell>
              {renderSave ? <TableCell>{renderSave(hit)}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

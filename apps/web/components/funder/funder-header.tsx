import * as React from "react";
import { ArrowUpRight, Globe, MapPin } from "lucide-react";

import { IrsStandingChip } from "@/components/data/irs-standing-chip";
import { Missing } from "@/components/data/missing";
import { Posture } from "@/components/data/posture";
import { SourceChip } from "@/components/data/source-chip";
import { Badge } from "@/components/ui/badge";
import {
  ADDRESS_FROM_RETURN,
  ADDRESS_FROM_RETURN_FILING_ID,
  IRS_MASTER_FILE_FULL_NAME,
  IRS_MASTER_FILE_LABEL,
  WEBSITE_FROM_FILING,
  WEBSITE_FROM_REGISTRY,
} from "@/lib/content/copy";
import { filingSourceLabel } from "@/lib/content/labels";
import { formatEin, formatMoneyCompact, formatNumber } from "@/lib/format";
import type { IrsStanding } from "@/lib/queries/corpus/standing-types";
import type { FunderRecord } from "@/lib/queries/corpus/types";

import { Seal } from "./provenance";

function websiteHref(site: string): string {
  return /^https?:\/\//i.test(site) ? site : `https://${site}`;
}

export function FunderHeader({
  funder,
  standing,
  actions,
}: {
  funder: FunderRecord;
  /** What the IRS lists say. Null when the lists are not loaded; the header then shows no chip. */
  standing?: IrsStanding | null;
  actions?: React.ReactNode;
}) {
  const location = funder.city && funder.state ? `${funder.city}, ${funder.state}` : (funder.state ?? funder.city);
  const websiteTitle =
    funder.websiteSource === "filing" ? WEBSITE_FROM_FILING(funder.websiteFy, funder.websiteReturnType ?? "990") : WEBSITE_FROM_REGISTRY;

  return (
    <header className="flex flex-col gap-4 border-b pb-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow text-muted-foreground">{funder.orgTypeLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{funder.name}</h1>
          {funder.legalName ? <p className="mt-0.5 text-sm text-ink-3">{funder.legalName}</p> : null}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            {location ? (
              <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {location}
                </span>
                {/* Not in the IRS master file: the address is the one the funder wrote on a return. */}
                {funder.addressFrom ? (
                  <span data-slot="address-basis" className="text-xs" title={ADDRESS_FROM_RETURN_FILING_ID(funder.addressFrom.objectId)}>
                    <span aria-hidden className="text-ink-4">
                      ·{" "}
                    </span>
                    {ADDRESS_FROM_RETURN(funder.addressFrom.fy)}
                  </span>
                ) : null}
              </span>
            ) : null}
            <span className="tnum inline-flex items-center gap-1">
              EIN{" "}
              {funder.ein ? (
                <SourceChip label={formatEin(funder.ein)} provenance={<Seal p={funder.bmf.provenance} />} />
              ) : (
                <Missing bare />
              )}
            </span>
            {funder.website ? (
              <a
                href={websiteHref(funder.website)}
                target="_blank"
                rel="noreferrer"
                title={websiteTitle}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Globe className="size-3.5" aria-hidden />
                Website
                <ArrowUpRight className="size-3" aria-hidden />
              </a>
            ) : null}
          </p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Posture value={funder.posture ?? "unknown"} />
        {/* "On no list" is an absence, not a finding: it stays in "The basics" and is not raised to the header. */}
        {standing && standing.standing !== "not_listed" ? <IrsStandingChip standing={standing} /> : null}
        {funder.nteeLabel ? <Badge variant="secondary">{funder.nteeLabel}</Badge> : null}
        {funder.grants.n && funder.grants.n > 0 ? (
          <Badge variant="outline" className="tnum">
            {formatNumber(funder.grants.n)} grants on file
            {funder.grants.total ? ` · ${formatMoneyCompact(funder.grants.total)}` : ""}
            {funder.grants.firstFy && funder.grants.lastFy ? ` · FY${funder.grants.firstFy}–${funder.grants.lastFy}` : ""}
          </Badge>
        ) : null}
        {funder.latest ? (
          <SourceChip label={filingSourceLabel(funder.latest.returnType, funder.latest.fy)} />
        ) : (
          <span title={IRS_MASTER_FILE_FULL_NAME}>
            <SourceChip label={IRS_MASTER_FILE_LABEL} provenance={<Seal p={funder.bmf.provenance} />} />
          </span>
        )}
      </div>
    </header>
  );
}

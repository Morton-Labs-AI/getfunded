import * as React from "react";
import { notFound } from "next/navigation";

import { Missing } from "@/components/data/missing";
import { filingSourceLabel } from "@/lib/content/labels";
import { formatDate, formatEin } from "@/lib/format";
import {
  getFunder,
  getFunderContacts,
  getFunderFilings,
  getFunderFinancials,
  getFunderGivingProfile,
  getFunderGrants,
  getFunderOfficers,
  getSimilarFunders,
} from "@/lib/queries/corpus/funder";
import { softFail } from "@/lib/queries/corpus/safe";
import type { GivingProfile, GrantsPage } from "@/lib/queries/corpus/types";

import { ApplySection } from "./apply-section";
import { ContactsSection } from "./contacts-section";
import { FinancialsSection } from "./financials-section";
import { FunderHeader } from "./funder-header";
import { GivingSection } from "./giving-section";
import { GrantsTable } from "./grants-table";
import { OfficersSection } from "./officers-section";
import { FactList, ProfileSection } from "./profile-section";
import { SimilarFunders } from "./similar-funders";
import { SourcesSection } from "./sources-section";

export type FunderProfileProps = {
  orgId: string;
  mode: "public" | "app";
  slots?: {
    /** Right of the name: the save button in app mode. */
    afterHeader?: React.ReactNode;
    /** Top of the side column: the fit panel in app mode. */
    sidebar?: React.ReactNode;
  };
  /** Grants table state from the page URL (`gpage`, `gq`). Page 1 when absent. */
  grants?: { page?: number; q?: string | null };
};

const EMPTY_GIVING: GivingProfile = { focus: [], geography: [], resolvedPct: null };

/**
 * The funder profile, shared by /funder/[id] (public) and /app/funders/[id]
 * (app, which passes its own slots). Server component; reads the corpus
 * plane only. Calls notFound() when the id is unknown.
 */
export async function FunderProfile({ orgId, mode, slots, grants }: FunderProfileProps) {
  const funder = await getFunder(orgId);
  if (!funder) notFound();

  const basePath = mode === "app" ? `/app/funders/${funder.orgId}` : `/funder/${funder.orgId}`;
  const funderBase = mode === "app" ? "/app/funders" : "/funder";

  const emptyGrants: GrantsPage = { rows: [], total: 0, page: 1, pageSize: 25, pageCount: 0, q: grants?.q ?? null };
  const [years, grantsPage, officers, contacts, similar, filings, giving] = await Promise.all([
    softFail("financials", [], () => getFunderFinancials(funder.orgId)),
    softFail("grants", emptyGrants, () => getFunderGrants(funder.orgId, { page: grants?.page, q: grants?.q })),
    softFail("officers", [], () => getFunderOfficers(funder.orgId)),
    softFail("contacts", [], () => getFunderContacts(funder.orgId)),
    softFail("similar", [], () => getSimilarFunders(funder.orgId)),
    softFail("filings", [], () => getFunderFilings(funder.orgId)),
    softFail("giving profile", EMPTY_GIVING, () => getFunderGivingProfile(funder.orgId)),
  ]);

  const latestYear = years.length > 0 ? years[years.length - 1] : null;
  const officersProvenance = latestYear?.provenance ?? null;
  const officersLabel = latestYear ? filingSourceLabel(latestYear.returnType, latestYear.fy) : null;

  const basics: [string, React.ReactNode][] = [
    ["EIN", funder.ein ? <span className="tnum font-mono">{formatEin(funder.ein)}</span> : <Missing bare />],
    ["Type", funder.orgTypeLabel],
    [
      "Address",
      funder.street || funder.city ? [funder.street, funder.city, funder.state, funder.zip].filter(Boolean).join(", ") : <Missing bare />,
    ],
    ["IRS category", funder.nteeLabel ? `${funder.nteeLabel}${funder.nteeCode ? ` (${funder.nteeCode})` : ""}` : <Missing bare />],
    ["Tax-exempt since", funder.rulingDate ? formatDate(funder.rulingDate, "year") : <Missing bare />],
    ["Returns on record", funder.latest ? String(funder.latest.nFilings) : <Missing bare />],
  ];

  return (
    <article className="flex flex-col gap-6">
      <FunderHeader funder={funder} actions={slots?.afterHeader} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <ApplySection funder={funder} />
          <FinancialsSection funder={funder} years={years} />
          <GivingSection profile={giving} />
          <GrantsTable grants={grantsPage} basePath={basePath} funderBase={funderBase} />
          <OfficersSection officers={officers} provenance={officersProvenance} sourceLabel={officersLabel} />
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {slots?.sidebar}
          <ProfileSection id="basics" title="The basics">
            <FactList facts={basics} />
          </ProfileSection>
          <ContactsSection channels={contacts} application={funder.application} />
          <SimilarFunders rows={similar} funderBase={funderBase} />
          <SourcesSection funder={funder} filings={filings} />
        </aside>
      </div>
    </article>
  );
}

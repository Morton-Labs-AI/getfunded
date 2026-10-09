import * as React from "react";
import { notFound } from "next/navigation";

import { IrsStandingChip } from "@/components/data/irs-standing-chip";
import { Missing } from "@/components/data/missing";
import { IRS_STANDING_BASICS_LABEL, PUB78_CLASS_LABEL, pub78ClassText } from "@/lib/content/irs-standing-copy";
import { filingSourceLabel } from "@/lib/content/labels";
import { formatDate, formatEin } from "@/lib/format";
import { getFunderApplicationHistory } from "@/lib/queries/corpus/application-history";
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
import { getFunderSignals } from "@/lib/queries/corpus/signals";
import { getFunderStanding } from "@/lib/queries/corpus/standing";
import type { GivingProfile, GrantsPage } from "@/lib/queries/corpus/types";

import { ApplySection } from "./apply-section";
import { ContactsSection } from "./contacts-section";
import { FinancialsSection } from "./financials-section";
import { FunderHeader } from "./funder-header";
import { GivingSection } from "./giving-section";
import { GrantsTable } from "./grants-table";
import { OfficersSection } from "./officers-section";
import { SignalsSection } from "./signals-section";
import { FactList, ProfileSection, type Fact } from "./profile-section";
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
  const [years, grantsPage, officers, contacts, similar, filings, giving, standing, applicationHistory, signals] = await Promise.all([
    softFail("financials", [], () => getFunderFinancials(funder.orgId)),
    softFail("grants", emptyGrants, () => getFunderGrants(funder.orgId, { page: grants?.page, q: grants?.q })),
    softFail("officers", [], () => getFunderOfficers(funder.orgId)),
    softFail("contacts", [], () => getFunderContacts(funder.orgId)),
    softFail("similar", [], () => getSimilarFunders(funder.orgId)),
    softFail("filings", [], () => getFunderFilings(funder.orgId)),
    softFail("giving profile", EMPTY_GIVING, () => getFunderGivingProfile(funder.orgId)),
    // Null until both IRS lists are loaded and readable. Null means "show nothing", never "listed".
    softFail("irs standing", null, () => getFunderStanding(funder.orgId)),
    // Null when the foundation has no history row or the relations are not readable yet.
    softFail("application history", null, () => getFunderApplicationHistory(funder.orgId)),
    // [] until corpus 0035 and getfunded_0015 are applied; the section renders nothing for [].
    softFail("signals", [], () => getFunderSignals(funder.orgId)),
  ]);

  const latestYear = years.length > 0 ? years[years.length - 1] : null;
  const officersProvenance = latestYear?.provenance ?? null;
  const officersLabel = latestYear ? filingSourceLabel(latestYear.returnType, latestYear.fy) : null;

  const basics: Fact[] = [
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
  // What the IRS lists say today, and the IRS's own class for deductible gifts.
  // No row at all when the lists are not loaded: an empty row would read as a finding.
  if (standing) {
    basics.push(
      [IRS_STANDING_BASICS_LABEL, <IrsStandingChip key="irs-standing" standing={standing} />, { wide: true }],
      [PUB78_CLASS_LABEL, pub78ClassText(standing), { wide: true }],
    );
  }

  return (
    <article className="flex flex-col gap-6">
      <FunderHeader funder={funder} standing={standing} actions={slots?.afterHeader} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <SignalsSection signals={signals} />
          <ApplySection funder={funder} standing={standing} history={applicationHistory} />
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

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getOrg,
  orgMergedRecords,
  orgIdentifiers,
  orgPeople,
  orgGrantsPaid,
  orgEventsReceived,
  orgFunderStats,
  orgGrantsByYear,
  orgFundsManaged,
  orgManagedBy,
  orgProgramsAdministered,
  orgContactCount,
  type PersonChip,
} from "@/lib/queries/orgs";
import {
  orgGrantsPage,
  orgGrantGeography,
  orgTopRecipients,
  orgFunderStatsExtended,
  orgProvenanceFiles,
  similarOrgs,
  orgWebFacts,
  type OrgWebFactsRow,
  type GrantPageRow,
  type GeoRow,
  type TopRecipientRow,
  type FunderStatsExtended,
  type ProvFileRow,
  type SimilarOrgRow,
} from "@/lib/queries/org-profile";
import { EventsTable } from "@/components/events-table";
import { GeoTable } from "@/components/org/geo-table";
import { SimilarPanel } from "@/components/org/similar-panel";
import { WebFacts } from "@/components/org/web-facts";
import { TopRecipients } from "@/components/org/top-recipients";
import { PeopleGroups } from "@/components/org/people-groups";
import { GrantsPager } from "@/components/org/grants-pager";
import { SourceGlyph } from "@/components/source-glyph";
import { TrichotomyBadge, CategoryRule } from "@/components/trichotomy-badge";
import { YearBars } from "@/components/year-bars";
import {
  PERSON_CAVEAT,
  NTEE_CAVEAT,
  RESOLVED_COVERAGE_NOTE,
} from "@/lib/content/facts";
import { nteeMajorLabel } from "@/lib/content/ntee";
import {
  moneyCompact,
  moneyFull,
  moneyRegister,
  countFull,
  MDASH,
  REL_LABEL,
} from "@/lib/format";

const GRANTS_PAGE_SIZE = 50;

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; q?: string; page?: string }>;
}) {
  const { id } = await params;
  const { from, q, page: pageParam } = await searchParams;
  const grantsPageNum = Math.max(1, Number(pageParam) || 1);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const org = await getOrg(id);
  if (!org) notFound();
  // Non-canonical rows redirect to their survivor (temporary, not permanent:
  // the canonical map is recomputed on every ER apply and the rep can change).
  if (org.canonical_org_id) redirect(`/org/${org.canonical_org_id}?from=${id}`);

  const merged = await orgMergedRecords(id);
  const memberIds = [id, ...merged.map((m) => m.id)];

  const [ids, people, funderStats, contactCount] = await Promise.all([
    orgIdentifiers(id),
    orgPeople(memberIds),
    orgFunderStats(memberIds),
    orgContactCount(id),
  ]);

  const isFoundation = org.org_type === "private_foundation";
  const isAdviser = ["vc", "pe", "investment_adviser"].includes(org.org_type);
  const isFund = org.org_type === "fund";
  const isAgency = org.org_type === "gov_agency";
  // Public charities are grantmakers too once Schedule I lands; unlike
  // foundations they keep the Funding-received section (they are also
  // grant recipients). Renders nothing new while they have no grant rows.
  const isCharity = org.org_type === "public_charity";
  const isGrantmaker = isFoundation || isAgency || isCharity;

  const [
    grants,
    received,
    byYear,
    funds,
    managers,
    programs,
    grantsPage,
    geo,
    topRecipients,
    extStats,
    provFiles,
    similar,
    webFacts,
  ] = await Promise.all([
    // Foundations move to the paged query below; agencies and charities keep
    // the top-25 path unchanged.
    isGrantmaker && !isFoundation ? orgGrantsPaid(memberIds) : Promise.resolve([]),
    !isAgency && !isFoundation ? orgEventsReceived(memberIds) : Promise.resolve([]),
    isGrantmaker ? orgGrantsByYear(memberIds) : Promise.resolve([]),
    isAdviser ? orgFundsManaged(id) : Promise.resolve([]),
    isFund ? orgManagedBy(id) : Promise.resolve([]),
    isAgency ? orgProgramsAdministered(id) : Promise.resolve([]),
    isFoundation
      ? orgGrantsPage(memberIds, { q, page: grantsPageNum, pageSize: GRANTS_PAGE_SIZE })
      : Promise.resolve([] as GrantPageRow[]),
    isFoundation ? orgGrantGeography(memberIds) : Promise.resolve([] as GeoRow[]),
    isFoundation ? orgTopRecipients(memberIds, 15) : Promise.resolve([] as TopRecipientRow[]),
    isFoundation
      ? orgFunderStatsExtended(memberIds)
      : Promise.resolve(null as FunderStatsExtended | null),
    isFoundation
      ? orgProvenanceFiles(memberIds, org.raw_file_id)
      : Promise.resolve([] as ProvFileRow[]),
    isFoundation ? similarOrgs(id) : Promise.resolve([] as SimilarOrgRow[]),
    isFoundation ? orgWebFacts(memberIds) : Promise.resolve(null as OrgWebFactsRow | null),
  ]);
  const grantsTotal = grantsPage[0]?.total_rows ?? 0;
  const grantsPageCount = Math.max(1, Math.ceil(grantsTotal / GRANTS_PAGE_SIZE));
  const nteeLabel = nteeMajorLabel(org.ntee_code);

  const prov = {
    dataset: org.dataset_name,
    sourceUrl: org.source_url,
    sha256: org.sha256,
    license: org.license_name,
    locator: org.source_record_locator,
    ingested: org.downloaded_at,
  };

  const grantStats = funderStats.filter((s) =>
    ["grant", "sbir_award", "sttr_award"].includes(s.event_type)
  );
  const totalGiven = grantStats.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const nGiven = grantStats.reduce((s, r) => s + Number(r.n), 0);

  return (
    <div className="page-enter mx-auto w-full max-w-[1200px] px-6 pb-16">
      {/* header */}
      <header className="pt-10">
        {from && (
          <div className="mb-3 text-[12.5px] text-ink-4">
            Redirected from a duplicate record (same real-world entity;
            provenance preserved on both rows).
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="mono-label">
            {[
              isFoundation ? org.street : null,
              [org.city, org.state].filter(Boolean).join(", ") || org.country,
            ]
              .filter(Boolean)
              .join(" · ")}
            {org.status !== "active" ? ` · ${org.status}` : ""}
          </span>
          <span className="flex items-center gap-3">
            {process.env.NODE_ENV === "development" && isFoundation && (
              <Link
                href={`/admin/enrich/${id}`}
                className="text-[12px] text-ink-4 underline decoration-dotted hover:text-ink-2"
              >
                {webFacts ? "update website info" : "add website info"}
              </Link>
            )}
            <Link
              href={`/?q=${encodeURIComponent(`Tell me about ${org.name} (org id ${org.id})`)}`}
              className="rounded-[8px] border border-accent-border px-3 py-1.5 text-[12.5px] font-medium text-accent transition-colors duration-[90ms] hover:bg-accent-tint"
            >
              Ask about this{" "}
              {isFoundation ? "foundation" : isAdviser ? "firm" : isCharity ? "charity" : "organization"}
            </Link>
          </span>
        </div>
        <h1 className="mt-2 text-[26px] font-[650] leading-8 tracking-[-0.02em] text-ink-1">
          {org.name}
        </h1>
        {org.legal_name && org.legal_name !== org.name && (
          <div className="mt-1 text-[13.5px] text-ink-3">{org.legal_name}</div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TrichotomyBadge orgType={org.org_type} />
          {org.is_era && (
            <span
              className="rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3"
              title="Exempt Reporting Adviser — files a reduced Form ADV under the venture-capital or private-fund adviser exemption"
            >
              ERA
            </span>
          )}
          {isFoundation && org.ntee_code && (
            <span
              className="rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[10.5px] tracking-[0.08em] text-ink-3"
              title={NTEE_CAVEAT}
            >
              {`NTEE ${org.ntee_code}${nteeLabel ? ` · ${nteeLabel}` : ""}`}
            </span>
          )}
          {ids.map((i) => (
            <IdChip key={`${i.id_type}:${i.id_value}`} idType={i.id_type} value={i.id_value} />
          ))}
          {isFoundation && org.ruling_date && (
            <span
              className="text-[12.5px] text-ink-4"
              title="Year the IRS ruled the organization tax-exempt (ruling date from the Business Master File)"
            >
              {`exempt since ${org.ruling_date.slice(0, 4)}`}
            </span>
          )}
          {merged.length > 0 && (
            <span
              className="rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3"
              title={merged
                .map((m) => `${m.dataset_name} · ${m.source_record_locator}`)
                .join("\n")}
            >
              {merged.length} merged record{merged.length > 1 ? "s" : ""}
            </span>
          )}
          {(() => {
            // Enrichment fills the gap for foundations (organizations.website
            // is never backfilled from website snapshots — provenance).
            const site = webFacts?.website_url ?? org.website;
            return site ? (
              <a
                href={site.startsWith("http") ? site : `https://${site}`}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] text-accent hover:text-accent-hover"
              >
                website ↗
              </a>
            ) : null;
          })()}
          {contactCount > 0 && (
            <span className="text-[12.5px] text-ink-4">
              {contactCount} contact channels on file (internal)
            </span>
          )}
        </div>
        <div className="mt-5">
          <CategoryRule orgType={org.org_type} />
        </div>
      </header>

      {/* stat row */}
      <section className="flex flex-wrap gap-8 border-b border-border-1 py-6">
        {(isFoundation || isCharity) && (
          <>
            <MoneyStat label="assets" value={org.asset_amount} prov={prov} />
            <MoneyStat label="income" value={org.income_amount} prov={prov} />
            <MoneyStat label="revenue" value={org.revenue_amount} prov={prov} />
          </>
        )}
        {isAdviser && (
          <>
            <MoneyStat label="regulatory AUM" value={org.aum} prov={prov} />
            <MoneyStat label="managed fund assets" value={org.fund_size} prov={prov} />
          </>
        )}
        {isFund && <MoneyStat label="gross asset value" value={org.fund_size} prov={prov} />}
        {isGrantmaker && nGiven > 0 && (
          <div className="flex flex-col gap-1">
            <span className="mono-label">
              {isAgency ? "awards on file" : "grants on file"}
            </span>
            <span className="tnum text-[30px] font-semibold leading-9 tracking-[-0.02em] text-ink-1">
              {countFull(nGiven)}
              <span className="ml-2 text-[15px] font-normal text-ink-3">
                · {moneyCompact(totalGiven)} total
                {grantStats[0]?.first_fy
                  ? ` · FY${Math.min(...grantStats.map((s) => s.first_fy ?? 9999))}–${Math.max(...grantStats.map((s) => s.last_fy ?? 0))}`
                  : ""}
              </span>
            </span>
          </div>
        )}
        {isFoundation && extStats?.median_amount && (
          <div className="flex flex-col gap-1">
            <span className="mono-label">median grant</span>
            <span
              className="tnum text-[30px] font-[620] leading-9 tracking-[-0.02em] text-ink-1"
              title={moneyFull(extStats.median_amount)}
            >
              {moneyCompact(extStats.median_amount)}
            </span>
          </div>
        )}
        {isFoundation && extStats && extStats.distinct_recipients > 0 && (
          <div className="flex flex-col gap-1">
            <span className="mono-label">distinct recipients</span>
            <span className="tnum text-[30px] font-[620] leading-9 tracking-[-0.02em] text-ink-1">
              {countFull(extStats.distinct_recipients)}
            </span>
          </div>
        )}
        {isFoundation &&
          extStats?.resolved_rows_pct != null &&
          extStats.resolved_dollars_pct != null && (
            <div className="flex flex-col gap-1">
              <span className="mono-label">resolved coverage</span>
              <span
                className="tnum text-[30px] font-[620] leading-9 tracking-[-0.02em] text-ink-1"
                title={RESOLVED_COVERAGE_NOTE(
                  extStats.resolved_rows_pct,
                  extStats.resolved_dollars_pct
                )}
              >
                {`${extStats.resolved_rows_pct}%`}
                <span className="ml-2 text-[15px] font-normal text-ink-3">
                  {`of rows · ${extStats.resolved_dollars_pct}% of $`}
                </span>
              </span>
            </div>
          )}
      </section>

      {/* enriched website facts (foundations, when a confirmed row exists) */}
      {isFoundation && webFacts && (
        <Section title="From the foundation's website">
          <WebFacts wf={webFacts} />
        </Section>
      )}

      {/* people */}
      {people.length > 0 && (
        <Section title={isAdviser ? "Owners & executives" : "People"}>
          {isFoundation ? (
            <PeopleGroups people={people} />
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {people.map((p) => (
                  <PersonChipEl key={p.person_id} p={p} />
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-ink-4">{PERSON_CAVEAT}</p>
            </>
          )}
        </Section>
      )}

      {/* grant geography (foundations) */}
      {isFoundation && geo.length > 0 && (
        <Section title="Grant geography">
          <GeoTable rows={geo} />
        </Section>
      )}

      {/* top recipients (foundations) */}
      {isFoundation && topRecipients.length > 0 && (
        <Section title="Top recipients">
          <TopRecipients rows={topRecipients} />
        </Section>
      )}

      {/* similar giving profiles (foundations) */}
      {isFoundation && similar.length > 0 && (
        <Section title="Similar giving profiles">
          <SimilarPanel rows={similar} />
        </Section>
      )}

      {/* grants paid — foundations get search + pagination over the full set */}
      {isFoundation && (grantsTotal > 0 || q) && (
        <Section
          title="Grants paid"
          aside={
            byYear.length > 0 ? (
              <YearBars data={byYear} fill="var(--cat-grant-fill)" unitLabel="grants" />
            ) : undefined
          }
        >
          <GrantsPager
            orgId={org.id}
            from={from}
            q={q}
            page={grantsPageNum}
            pageCount={grantsPageCount}
            total={grantsTotal}
          />
          {grantsPage.length > 0 ? (
            <EventsTable rows={grantsPage} prov={prov} />
          ) : (
            <p className="text-[13px] text-ink-3">
              No grants match this search.
            </p>
          )}
        </Section>
      )}

      {/* grants paid (agencies, charities — unchanged top-25 path) */}
      {!isFoundation && isGrantmaker && grants.length > 0 && (
        <Section
          title={isAgency ? "Awards made" : "Grants paid"}
          aside={
            byYear.length > 0 ? (
              <YearBars data={byYear} fill="var(--cat-grant-fill)" unitLabel="grants" />
            ) : undefined
          }
        >
          <EventsTable rows={grants} prov={prov} showType={isAgency} />
        </Section>
      )}

      {/* funds managed */}
      {isAdviser && funds.length > 0 && (
        <Section title={`Funds managed (${funds.length})`}>
          <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-raised">
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">fund</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">gross assets</th>
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr key={f.org_id} className="border-b border-border-1 last:border-0">
                    <td className="px-3.5 py-2">
                      <Link href={`/org/${f.org_id}`} className="font-medium text-accent hover:text-accent-hover">
                        {f.name}
                      </Link>
                    </td>
                    <td className="px-3.5 py-2 text-ink-3">{f.focus_areas[0] ?? MDASH}</td>
                    <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                      {f.fund_size ? moneyFull(f.fund_size) : MDASH}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* managed by (funds) */}
      {isFund && managers.length > 0 && (
        <Section title="Managed by">
          {managers.map((m) => (
            <Link
              key={m.org_id}
              href={`/org/${m.org_id}`}
              className="mr-3 font-medium text-accent hover:text-accent-hover"
            >
              {m.name}
            </Link>
          ))}
        </Section>
      )}

      {/* programs (agencies) */}
      {isAgency && programs.length > 0 && (
        <Section title="Programs administered">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {programs.map((p) => (
              <Link
                key={p.id}
                href={`/programs/${p.id}`}
                className="rounded-[10px] border border-border-1 bg-surface px-4 py-3 transition-colors duration-[90ms] hover:border-border-2"
              >
                <div className="text-[13.5px] font-semibold text-ink-1">{p.name}</div>
                <div className="mt-1.5 flex gap-2">
                  <TrichotomyBadge eventType="sbir_award" label={p.program_type} />
                  {p.funds_lab_not_company && (
                    <span className="rounded-[5px] px-2 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.08em]"
                      style={{ background: "color-mix(in srgb, var(--caution) 12%, transparent)", color: "var(--caution)" }}>
                      funds a lab, not you
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* events received (companies, funds) */}
      {received.length > 0 && (
        <Section title="Funding received">
          <EventsTable rows={received} prov={prov} showType received />
        </Section>
      )}

      {/* provenance */}
      <Section title="Provenance">
        {isFoundation && provFiles.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-border-1 bg-surface px-4 py-3.5 text-[13px] text-ink-2">
            {provFiles.map((f) => (
              <div key={f.raw_file_id}>
                <SourceGlyph
                  prov={{
                    dataset: f.dataset_name,
                    sourceUrl: f.source_url,
                    sha256: f.sha256,
                    license: f.license_name,
                    locator:
                      f.raw_file_id === org.raw_file_id
                        ? org.source_record_locator
                        : null,
                    ingested: f.downloaded_at,
                  }}
                >
                  <span className="font-mono text-[12px]">{f.dataset_name}</span>
                </SourceGlyph>
                <span className="text-ink-3"> · {f.license_name}</span>
                {f.raw_file_id === org.raw_file_id && (
                  <>
                    <span className="text-ink-3"> · record </span>
                    <span className="font-mono text-[12px] text-ink-3">
                      {org.source_record_locator}
                    </span>
                  </>
                )}
                {Number(f.n_events) > 0 && (
                  <span className="text-ink-4">
                    {` · ${countFull(f.n_events)} grant row${Number(f.n_events) > 1 ? "s" : ""}`}
                    {f.first_fy
                      ? f.first_fy === f.last_fy
                        ? ` · FY${f.first_fy}`
                        : ` · FY${f.first_fy}–${f.last_fy}`
                      : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[10px] border border-border-1 bg-surface px-4 py-3.5 text-[13px] text-ink-2">
            <SourceGlyph prov={prov}>
              <span className="font-mono text-[12px]">{org.dataset_name}</span>
            </SourceGlyph>
            <span className="text-ink-3"> · {org.license_name} · record </span>
            <span className="font-mono text-[12px] text-ink-3">{org.source_record_locator}</span>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------- helpers ---------- */

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border-1 py-7 last:border-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-ink-1">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function MoneyStat({
  label,
  value,
  prov,
}: {
  label: string;
  value: string | null;
  prov: Parameters<typeof SourceGlyph>[0]["prov"];
}) {
  const reg = moneyRegister(value);
  return (
    <div className="flex flex-col gap-1">
      <span className="mono-label">{label}</span>
      <SourceGlyph prov={prov}>
        {reg ? (
          <span
            className="tnum text-[30px] font-[620] leading-9 tracking-[-0.02em] text-ink-1"
            title={value ? moneyFull(value) : undefined}
          >
            <span className="text-[0.72em] font-medium text-ink-3">{reg.symbol}</span>
            {reg.digits}
            <span className="text-[0.72em] font-medium text-ink-3">{reg.suffix}</span>
          </span>
        ) : (
          <span className="text-[30px] font-[620] leading-9 text-ink-4">{MDASH}</span>
        )}
      </SourceGlyph>
    </div>
  );
}

function PersonChipEl({ p }: { p: PersonChip }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-[8px] border border-border-1 bg-surface px-2.5 py-1.5"
      title={`${p.title ?? REL_LABEL[p.rel_type] ?? p.rel_type} · source: ${p.dataset_name}`}
    >
      <span className="text-[13px] font-medium text-ink-1">{p.full_name}</span>
      <span className="mono-label normal-case tracking-[0.04em]">
        {(p.title ?? REL_LABEL[p.rel_type] ?? "").toLowerCase().slice(0, 26)}
      </span>
    </span>
  );
}

const ID_LINKS: Record<string, (v: string) => string> = {
  crd: (v) => `https://adviserinfo.sec.gov/firm/summary/${v}`,
  cik: (v) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${v}`,
  ein: (v) => `https://projects.propublica.org/nonprofits/organizations/${v}`,
};

function IdChip({ idType, value }: { idType: string; value: string }) {
  const href = ID_LINKS[idType]?.(value);
  const body = (
    <span className="tnum inline-flex items-center gap-1.5 rounded-[5px] bg-inset px-2 py-[3px] font-mono text-[11.5px] text-ink-2">
      <span className="uppercase text-ink-4">{idType.replaceAll("_", " ")}</span>
      {value}
      {href && <span className="text-ink-4">↗</span>}
    </span>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    body
  );
}

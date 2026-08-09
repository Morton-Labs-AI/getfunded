import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getFiling,
  filingOfficers,
  filingContributors,
  filingAppInfo,
  filingGrantsPage,
  filingCommitments,
} from "@/lib/queries/filings";
import { EventsTable } from "@/components/events-table";
import { GrantsPager } from "@/components/org/grants-pager";
import { BreakdownBars } from "@/components/breakdown-bars";
import { Section, MoneyStat } from "@/components/page-primitives";
import { SourceGlyph, type Provenance } from "@/components/source-glyph";
import {
  FILING_AS_FILED_NOTE,
  AMENDED_RULE_NOTE,
  SCHEDULE_B_NOTE,
  HOW_TO_APPLY_NOTE,
} from "@/lib/content/facts";
import { moneyFull, countFull, dateShort, MDASH } from "@/lib/format";

const GRANTS_PAGE_SIZE = 50;

export default async function FilingPage({
  params,
  searchParams,
}: {
  params: Promise<{ objectId: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { objectId } = await params;
  const { q, page: pageParam } = await searchParams;
  const pageNum = Math.max(1, Number(pageParam) || 1);
  if (!/^\d{18}$/.test(objectId)) notFound();

  const filing = await getFiling(objectId);
  if (!filing) notFound();

  const [officers, contributors, appInfo, grantsPage, commitments] =
    await Promise.all([
      filingOfficers(objectId),
      filingContributors(objectId),
      filingAppInfo(objectId),
      filingGrantsPage(objectId, { q, page: pageNum, pageSize: GRANTS_PAGE_SIZE }),
      filingCommitments(objectId),
    ]);
  const grantsTotal = grantsPage[0]?.total_rows ?? 0;
  const grantsPageCount = Math.max(1, Math.ceil(grantsTotal / GRANTS_PAGE_SIZE));

  const superseded = filing.superseded_by_object_id !== null;
  const returnLabel = filing.return_type === "990PF" ? "990-PF" : filing.return_type;
  const orgName = filing.org_name ?? filing.taxpayer_name ?? `EIN ${filing.ein}`;
  const prov: Provenance = {
    dataset: filing.dataset_name,
    sourceUrl: filing.source_url,
    sha256: filing.sha256,
    license: filing.license_name,
    locator: filing.object_id,
    ingested: filing.downloaded_at,
  };
  const net =
    filing.total_revenue !== null && filing.total_expenses !== null
      ? String(Number(filing.total_revenue) - Number(filing.total_expenses))
      : null;
  const xmlAvailable = Boolean(process.env.FUNDERDB_RAW_DIR);

  const headerBits = [
    filing.tax_period_begin && filing.tax_period_end
      ? `tax year ${dateShort(filing.tax_period_begin)} – ${dateShort(filing.tax_period_end)}`
      : filing.tax_period
        ? `tax period ${filing.tax_period}`
        : null,
    filing.return_ts ? `filed ${dateShort(filing.return_ts)}` : null,
    filing.dln ? `DLN ${filing.dln}` : null,
    filing.accounting_method ? `${filing.accounting_method} basis` : null,
  ].filter(Boolean);

  return (
    <div className="page-enter mx-auto w-full max-w-[1200px] px-6 pb-16">
      <header className="pt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="mono-label">
            {filing.org_link_id ? (
              <Link
                href={`/org/${filing.org_link_id}`}
                className="text-accent hover:text-accent-hover"
              >
                ← {orgName}
              </Link>
            ) : (
              orgName
            )}
          </span>
          <span className="flex items-center gap-3">
            {xmlAvailable && (
              <a
                href={`/filing/${filing.object_id}/xml`}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-ink-4 underline decoration-dotted hover:text-ink-2"
              >
                view raw XML ↗
              </a>
            )}
            <Link
              href={`/?q=${encodeURIComponent(
                `Tell me about the FY${filing.fy ?? "?"} Form ${returnLabel} filing of ${orgName} (filing ${filing.object_id})`
              )}`}
              className="rounded-[8px] border border-accent-border px-3 py-1.5 text-[12.5px] font-medium text-accent transition-colors duration-[90ms] hover:bg-accent-tint"
            >
              Ask about this filing
            </Link>
          </span>
        </div>
        <h1 className="mt-2 text-[26px] font-[650] leading-8 tracking-[-0.02em] text-ink-1">
          {orgName}
          <span className="ml-3 text-[17px] font-normal text-ink-3">
            {`Form ${returnLabel}${filing.fy ? ` · FY${filing.fy}` : ""}`}
          </span>
        </h1>
        <div className="mt-2 text-[12.5px] text-ink-4">{headerBits.join(" · ")}</div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-3">
          {filing.signing_officer_name && (
            <span className="fact" title="Signing officer, from the return header">
              {`signed by ${filing.signing_officer_name}${filing.signing_officer_title ? `, ${filing.signing_officer_title.toLowerCase()}` : ""}${filing.signature_date ? ` · ${dateShort(filing.signature_date)}` : ""}`}
            </span>
          )}
          {filing.phone && <span>{`phone ${filing.phone}`}</span>}
          {filing.filer_addr_line1 && (
            <span>
              {[filing.filer_addr_line1, filing.filer_city, filing.filer_state]
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </div>
      </header>

      {/* amendment banners */}
      {superseded && (
        <div
          className="mt-5 rounded-[10px] px-4 py-3 text-[13px]"
          style={{
            background: "color-mix(in srgb, var(--caution) 10%, transparent)",
            color: "var(--caution)",
          }}
        >
          This return was amended. Figures below are as originally filed —{" "}
          <Link
            href={`/filing/${filing.superseded_by_object_id}`}
            className="font-medium underline"
          >
            see the amended filing →
          </Link>
        </div>
      )}
      {!superseded && filing.amends_object_id && (
        <div className="mt-5 text-[12.5px] text-ink-4">
          Amends an earlier return —{" "}
          <Link
            href={`/filing/${filing.amends_object_id}`}
            className="text-accent hover:text-accent-hover"
          >
            view the original
          </Link>
          . {AMENDED_RULE_NOTE}
        </div>
      )}

      {/* key figures */}
      <section className="mt-2 flex flex-wrap gap-8 border-b border-border-1 py-6">
        <MoneyStat label="revenue" value={filing.total_revenue} prov={prov} />
        <MoneyStat label="expenses" value={filing.total_expenses} prov={prov} />
        <MoneyStat label="net income" value={net} prov={prov} />
        <MoneyStat label="net assets (eoy)" value={filing.net_assets_eoy} prov={prov} />
        <MoneyStat label="assets at fmv" value={filing.fmv_assets_eoy} prov={prov} />
        <MoneyStat
          label="qualifying distributions"
          value={filing.qualifying_distributions}
          prov={prov}
        />
      </section>

      {filing.has_financials && (
        <Section
          title="Revenue & expenses"
          aside={<span className="text-[11.5px] text-ink-4">{FILING_AS_FILED_NOTE}</span>}
        >
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <div className="mono-label mb-2.5">revenue (per books)</div>
              <BreakdownBars
                fill="var(--cat-grant-fill)"
                total={filing.total_revenue}
                rows={[
                  { label: "contributions received", value: filing.contributions_received },
                  { label: "interest", value: filing.interest_income },
                  { label: "dividends", value: filing.dividends },
                  { label: "gross rents", value: filing.gross_rents },
                  { label: "net gain on asset sales", value: filing.net_gain_sale_assets },
                  { label: "other income", value: filing.other_income },
                ]}
              />
            </div>
            <div>
              <div className="mono-label mb-2.5">expenses (per books)</div>
              <BreakdownBars
                fill="var(--cat-grant-fill)"
                total={filing.total_expenses}
                rows={[
                  { label: "contributions & grants paid", value: filing.contributions_paid },
                  { label: "officer compensation", value: filing.officer_comp },
                  { label: "other salaries & wages", value: filing.other_salaries },
                  { label: "pension & benefits", value: filing.pension_benefits },
                  { label: "legal fees", value: filing.legal_fees },
                  { label: "accounting fees", value: filing.accounting_fees },
                  { label: "other professional fees", value: filing.other_prof_fees },
                  { label: "interest", value: filing.interest_expense },
                  { label: "taxes", value: filing.taxes },
                  { label: "depreciation", value: filing.depreciation },
                  { label: "occupancy", value: filing.occupancy },
                  { label: "travel & conferences", value: filing.travel_conferences },
                  { label: "printing & publications", value: filing.printing_publications },
                  { label: "other expenses", value: filing.other_expenses },
                ]}
              />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-3">
            {([
              ["net investment income", filing.net_investment_income],
              ["adjusted net income", filing.adjusted_net_income],
              ["capital gain net income", filing.capital_gain_net_income],
              ["excise tax on investment income", filing.excise_tax],
              ["charitable disbursements (col. d)", filing.charitable_disbursements],
            ] as const).map(([label, v]) =>
              v !== null ? (
                <span key={label} className="tnum">
                  {label}: <span className="font-mono text-ink-1">{moneyFull(v)}</span>
                </span>
              ) : null
            )}
          </div>
        </Section>
      )}

      {filing.has_financials && (
        <Section title="Balance sheet">
          <div className="max-w-[560px] overflow-hidden rounded-[10px] border border-border-1 bg-surface">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="bg-raised">
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left"> </th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">beginning of year</th>
                  <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">end of year</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ["total assets (book)", filing.total_assets_boy, filing.total_assets_eoy],
                  ["total assets (fmv)", null, filing.total_assets_eoy_fmv],
                  ["total liabilities", filing.total_liabilities_boy, filing.total_liabilities_eoy],
                  ["net assets / fund balances", filing.net_assets_boy, filing.net_assets_eoy],
                ] as const).map(([label, boy, eoy]) => (
                  <tr key={label} className="border-b border-border-1 last:border-0">
                    <td className="px-3.5 py-2 text-ink-2">{label}</td>
                    <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                      {moneyFull(boy)}
                    </td>
                    <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                      {moneyFull(eoy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-3">
            {([
              ["minimum investment return", filing.min_investment_return],
              ["distributable amount", filing.distributable_amount],
              ["undistributed income (cy)", filing.undistributed_income_cy],
            ] as const).map(([label, v]) =>
              v !== null ? (
                <span key={label} className="tnum">
                  {label}: <span className="font-mono text-ink-1">{moneyFull(v)}</span>
                </span>
              ) : null
            )}
          </div>
        </Section>
      )}

      {/* officers as filed */}
      {officers.length > 0 && (
        <Section title={`Officers, directors & trustees (${officers.length})`}>
          <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-raised">
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">name</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">title</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">hrs/wk</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">compensation</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">benefits</th>
                  </tr>
                </thead>
                <tbody>
                  {officers.map((o) => (
                    <tr key={o.seq} className="border-b border-border-1 last:border-0">
                      <td className="px-3.5 py-2 text-ink-2">
                        {/* as-filed rows, never fake person links */}
                        <span>{o.person_name ?? o.business_name}</span>
                        {o.business_name && (
                          <span className="ml-2 rounded-[5px] bg-inset px-1.5 py-[2px] font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
                            org
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2 text-ink-3">{o.title ?? MDASH}</td>
                      <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                        {o.avg_hours_per_week ?? MDASH}
                      </td>
                      <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                        {moneyFull(o.compensation)}
                      </td>
                      <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                        {moneyFull(o.employee_benefits)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>
      )}

      {/* grants paid in this filing */}
      {(grantsTotal > 0 || q) && (
        <Section title="Grants paid in this filing">
          {superseded && (
            <p className="mb-3 text-[12.5px] text-ink-4">
              Grant rows live on the amended filing; this original's rows were
              superseded with it.
            </p>
          )}
          <GrantsPager
            orgId={filing.org_link_id ?? ""}
            basePath={`/filing/${filing.object_id}`}
            q={q}
            page={pageNum}
            pageCount={grantsPageCount}
            total={grantsTotal}
          />
          {grantsPage.length > 0 ? (
            <EventsTable rows={grantsPage} prov={prov} />
          ) : (
            <p className="text-[13px] text-ink-3">No grants match this search.</p>
          )}
          {filing.total_grants_paid !== null && (
            <p className="mt-3 text-[11.5px] text-ink-4">
              {`Foundation-reported total grants paid: ${moneyFull(filing.total_grants_paid)} (Part XV).`}
            </p>
          )}
        </Section>
      )}
      {grantsTotal === 0 && !q && superseded && (
        <Section title="Grants paid in this filing">
          <p className="text-[13px] text-ink-3">
            Grant rows live on the amended filing —{" "}
            <Link
              href={`/filing/${filing.superseded_by_object_id}`}
              className="text-accent hover:text-accent-hover"
            >
              view them there
            </Link>
            .
          </p>
        </Section>
      )}

      {/* future commitments */}
      {commitments.length > 0 && (
        <Section title={`Approved for future payment (${countFull(commitments.length)})`}>
          <p className="mb-3 text-[11.5px] text-ink-4">
            Part XV grants approved but not yet paid — commitments, not
            disbursements; never counted in grant totals.
            {filing.total_grants_approved_future !== null &&
              ` Foundation-reported total: ${moneyFull(filing.total_grants_approved_future)}.`}
          </p>
          <EventsTable rows={commitments} prov={prov} />
        </Section>
      )}

      {/* Schedule B */}
      {contributors.length > 0 && (
        <Section title={`Contributors · Schedule B (${contributors.length})`}>
          <div className="max-w-[760px] overflow-hidden rounded-[10px] border border-border-1 bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="bg-raised">
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">contributor</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">location</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">amount</th>
                    <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>
                  </tr>
                </thead>
                <tbody>
                  {contributors.map((c) => (
                    <tr key={c.seq} className="border-b border-border-1 last:border-0">
                      <td className="px-3.5 py-2 text-ink-2">
                        {c.person_name ?? c.business_name ?? MDASH}
                      </td>
                      <td className="px-3.5 py-2 text-ink-3">
                        {[c.city, c.state ?? c.country].filter(Boolean).join(", ") || MDASH}
                      </td>
                      <td className="tnum px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                        {moneyFull(c.total_contributions)}
                      </td>
                      <td className="px-3.5 py-2 text-[12px] text-ink-3">
                        {[
                          c.is_person ? "person" : null,
                          c.is_payroll ? "payroll" : null,
                          c.is_noncash ? "non-cash" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || MDASH}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-[11.5px] text-ink-4">{SCHEDULE_B_NOTE}</p>
        </Section>
      )}

      {/* how to apply (Part XV) */}
      {appInfo && (
        <Section title="How to apply · as reported on Part XV">
          {appInfo.only_preselected && (
            <p className="mb-3 text-[13px] font-medium" style={{ color: "var(--caution)" }}>
              The foundation reports it only makes contributions to
              preselected charitable organizations and does not accept
              unsolicited requests for funds.
            </p>
          )}
          <div className="flex flex-col gap-2 text-[13.5px] text-ink-2">
            {appInfo.contact_name && (
              <div>
                <span className="mono-label mr-2">apply to</span>
                {appInfo.contact_name}
                {appInfo.addr_line1 &&
                  ` · ${[appInfo.addr_line1, appInfo.city, appInfo.state, appInfo.zip].filter(Boolean).join(", ")}`}
              </div>
            )}
            {(appInfo.email || appInfo.phone) && (
              <div>
                <span className="mono-label mr-2">contact</span>
                {[appInfo.email, appInfo.phone].filter(Boolean).join(" · ")}
              </div>
            )}
            {appInfo.form_and_info_txt && (
              <div>
                <span className="mono-label mr-2">form & materials</span>
                {appInfo.form_and_info_txt}
              </div>
            )}
            {appInfo.submission_deadlines_txt && (
              <div>
                <span className="mono-label mr-2">deadlines</span>
                {appInfo.submission_deadlines_txt}
              </div>
            )}
            {appInfo.restrictions_txt && (
              <div>
                <span className="mono-label mr-2">restrictions</span>
                {appInfo.restrictions_txt}
              </div>
            )}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-4">{HOW_TO_APPLY_NOTE}</p>
        </Section>
      )}

      {/* provenance */}
      <Section title="Provenance">
        <div className="rounded-[10px] border border-border-1 bg-surface px-4 py-3.5 text-[13px] text-ink-2">
          <SourceGlyph prov={prov}>
            <span className="font-mono text-[12px]">{filing.dataset_name}</span>
          </SourceGlyph>
          <span className="text-ink-3">
            {" "}
            · {filing.license_name} · record{" "}
          </span>
          <span className="font-mono text-[12px] text-ink-3">{filing.object_id}</span>
          {filing.return_version && (
            <span className="text-ink-4">{` · schema ${filing.return_version}`}</span>
          )}
          <span className="text-ink-4">
            {" "}
            · <Link href="/data" className="text-accent hover:text-accent-hover">how this data is built</Link>
          </span>
        </div>
      </Section>
    </div>
  );
}

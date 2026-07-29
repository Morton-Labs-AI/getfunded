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
  type EventRow,
  type PersonChip,
} from "@/lib/queries/orgs";
import { SourceGlyph } from "@/components/source-glyph";
import { TrichotomyBadge, CategoryRule } from "@/components/trichotomy-badge";
import {
  moneyCompact,
  moneyFull,
  moneyRegister,
  countFull,
  MDASH,
  ORG_TYPE_LABELS,
  EVENT_TYPE_LABELS,
} from "@/lib/format";

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
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

  const [grants, received, byYear, funds, managers, programs] =
    await Promise.all([
      isFoundation || isAgency ? orgGrantsPaid(memberIds) : Promise.resolve([]),
      !isAgency && !isFoundation ? orgEventsReceived(memberIds) : Promise.resolve([]),
      isFoundation || isAgency ? orgGrantsByYear(memberIds) : Promise.resolve([]),
      isAdviser ? orgFundsManaged(id) : Promise.resolve([]),
      isFund ? orgManagedBy(id) : Promise.resolve([]),
      isAgency ? orgProgramsAdministered(id) : Promise.resolve([]),
    ]);

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
            {[org.city, org.state].filter(Boolean).join(", ") || org.country}
            {org.status !== "active" ? ` · ${org.status}` : ""}
          </span>
          <Link
            href={`/?q=${encodeURIComponent(`Tell me about ${org.name} (org id ${org.id})`)}`}
            className="rounded-[8px] border border-accent-border px-3 py-1.5 text-[12.5px] font-medium text-accent transition-colors duration-[90ms] hover:bg-accent-tint"
          >
            Ask about this {isFoundation ? "foundation" : isAdviser ? "firm" : "organization"}
          </Link>
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
          {ids.map((i) => (
            <IdChip key={`${i.id_type}:${i.id_value}`} idType={i.id_type} value={i.id_value} />
          ))}
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
          {org.website && (
            <a
              href={org.website.startsWith("http") ? org.website : `https://${org.website}`}
              target="_blank"
              rel="noreferrer"
              className="text-[12.5px] text-accent hover:text-accent-hover"
            >
              website ↗
            </a>
          )}
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
        {isFoundation && (
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
        {(isFoundation || isAgency) && nGiven > 0 && (
          <div className="flex flex-col gap-1">
            <span className="mono-label">
              {isFoundation ? "grants on file" : "awards on file"}
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
      </section>

      {/* people */}
      {people.length > 0 && (
        <Section title={isAdviser ? "Owners & executives" : "People"}>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => (
              <PersonChipEl key={p.person_id} p={p} />
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-4">
            Person records are per-source until Phase 2 entity resolution.
          </p>
        </Section>
      )}

      {/* grants paid */}
      {(isFoundation || isAgency) && grants.length > 0 && (
        <Section
          title={isFoundation ? "Grants paid" : "Awards made"}
          aside={byYear.length > 0 ? <YearBars data={byYear} /> : undefined}
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
        <div className="rounded-[10px] border border-border-1 bg-surface px-4 py-3.5 text-[13px] text-ink-2">
          <SourceGlyph prov={prov}>
            <span className="font-mono text-[12px]">{org.dataset_name}</span>
          </SourceGlyph>
          <span className="text-ink-3"> · {org.license_name} · record </span>
          <span className="font-mono text-[12px] text-ink-3">{org.source_record_locator}</span>
        </div>
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

const REL_LABEL: Record<string, string> = {
  officer_of: "officer",
  director_of: "director",
  trustee_of: "trustee",
  owner_of: "owner",
  executive_of: "executive",
  poc_for: "poc",
};

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

function YearBars({ data }: { data: { fy: number; n: string; total: string | null }[] }) {
  const max = Math.max(...data.map((d) => Number(d.total ?? 0)), 1);
  return (
    <div className="flex items-end gap-2.5">
      {data.map((d) => (
        <div key={d.fy} className="flex flex-col items-center gap-1">
          <span className="tnum font-mono text-[10px] text-ink-3">
            {moneyCompact(d.total)}
          </span>
          <div
            className="w-8 rounded-t-[2px]"
            style={{
              height: Math.max(6, (Number(d.total ?? 0) / max) * 48),
              background: "var(--cat-grant-fill)",
            }}
            title={`FY${d.fy}: ${countFull(d.n)} grants · ${moneyFull(d.total)}`}
          />
          <span className="tnum font-mono text-[10px] text-ink-4">{d.fy}</span>
        </div>
      ))}
    </div>
  );
}

function EventsTable({
  rows,
  prov,
  showType,
  received,
}: {
  rows: EventRow[];
  prov: Parameters<typeof SourceGlyph>[0]["prov"];
  showType?: boolean;
  received?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-border-1 bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="bg-raised">
              {showType && <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">type</th>}
              {!received && <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">recipient</th>}
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-left">
                {received ? "detail" : "purpose"}
              </th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">amount</th>
              <th className="mono-label border-b border-border-1 px-3.5 py-2 text-right">fy / date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-border-1 last:border-0 align-top">
                {showType && (
                  <td className="whitespace-nowrap px-3.5 py-2">
                    <TrichotomyBadge eventType={e.event_type} label={EVENT_TYPE_LABELS[e.event_type]} />
                  </td>
                )}
                {!received && (
                  <td className="max-w-[260px] px-3.5 py-2 text-ink-2">
                    {e.recipient_org_id ? (
                      <Link
                        href={`/org/${e.recipient_org_id}`}
                        className="font-medium text-accent hover:text-accent-hover"
                      >
                        {e.recipient_name}
                      </Link>
                    ) : (
                      <span
                        className="as-reported"
                        title="As reported in the filing; no resolved org record (unmatched recipients stay as-reported — never stubbed)"
                      >
                        {e.recipient_name}
                      </span>
                    )}
                    {(e.recipient_city || e.recipient_state) && (
                      <span className="text-ink-4">
                        {" "}
                        · {[e.recipient_city, e.recipient_state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </td>
                )}
                <td className="max-w-[380px] px-3.5 py-2 text-ink-3">
                  {e.purpose_text ? (
                    <span title={e.purpose_text.length > 90 ? e.purpose_text : undefined}>
                      {e.purpose_text.slice(0, 90)}
                      {e.purpose_text.length > 90 ? "…" : ""}
                    </span>
                  ) : (
                    MDASH
                  )}
                </td>
                <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-1">
                  <SourceGlyph prov={{ ...prov, locator: e.source_record_locator }}>
                    {e.amount ? moneyFull(e.amount) : MDASH}
                  </SourceGlyph>
                </td>
                <td className="tnum whitespace-nowrap px-3.5 py-2 text-right font-mono text-[12.5px] text-ink-3">
                  {e.fiscal_year ?? e.event_date ?? MDASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

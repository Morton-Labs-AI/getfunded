import "server-only";
/**
 * The fit evidence package: everything the fit model may reason from, built
 * from the corpus plane (read-only) and the workspace plane (RLS), each item
 * carrying the id the model must cite.
 *
 * Funder items come from public filings only: identity, latest financials, a
 * short giving series, application posture with the Part XV text, grant
 * statistics, the largest grants, giving geography, similar funders, and the
 * website the filer stated. Applicant items come from the workspace profile
 * and APPROVED knowledge rows only (`approved = true`); nothing else a member
 * typed ever enters a prompt.
 *
 * Honesty: a missing number is written as "not available", never 0; the
 * posture word for an absent statement is "Not stated in filings"; the word
 * "closed" never appears.
 */
import type postgres from "postgres";
import { withUser, type Db } from "@/lib/billing/db";
import { corpusQuery } from "@/lib/db/corpus";
import { addApplicantEvidence, readProfile, type Applicant } from "./applicant";
import { EvidenceBuilder, clip, moneyForModel, type EvidenceItem } from "./evidence";
import { FunderNotFoundError } from "./http";

export type CorpusRunner = <T>(fn: (sql: postgres.TransactionSql) => Promise<T>) => Promise<T>;
export type UserRunner = <T>(userId: string | null, fn: (sql: Db) => Promise<T>) => Promise<T>;

export type EvidenceDeps = { corpus?: CorpusRunner; withUser?: UserRunner };

export type FitEvidencePackage = {
  orgId: string;
  funderName: string;
  applicantName: string;
  items: EvidenceItem[];
  /** Nothing in the corpus beyond identity: an analysis would be guesswork. */
  thin: boolean;
  /** True when the workspace profile has no mission and no program areas. */
  applicantEmpty: boolean;
};

export const POSTURE_WORDS: Record<string, string> = {
  open: "Accepts applications",
  preselected_only: "Funds preselected organizations only",
  unknown: "Not stated in filings",
};

export const ORG_TYPE_WORDS: Record<string, string> = {
  private_foundation: "private foundation",
  public_charity: "public charity",
  fund: "fund",
  company: "company",
  investment_adviser: "investment adviser",
  pe: "private equity firm",
  vc: "venture capital firm",
  gov_agency: "government agency",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Workspace name, profile and approved knowledge, under RLS. */
export async function loadApplicant(sql: Db, workspaceId: string): Promise<Applicant | null> {
  const ws = await sql`
    select name, profile from getfunded.workspaces
    where id = ${workspaceId}::uuid and deleted_at is null`;
  const row = ws[0] as { name: string; profile: unknown } | undefined;
  if (!row) return null;
  const knowledge = await sql`
    select id, kind, title, body from getfunded.knowledge
    where workspace_id = ${workspaceId}::uuid and approved = true
    order by kind, created_at
    limit 30`;
  return {
    name: row.name,
    profile: readProfile(row.profile),
    knowledge: (knowledge as Array<{ id: unknown; kind: string; title: string; body: string }>).map((k) => ({
      id: String(k.id),
      kind: k.kind,
      title: k.title,
      body: k.body,
    })),
  };
}

type Soft = <T>(fallback: T, fn: (s: postgres.TransactionSql) => Promise<T>) => Promise<T>;

/** Run a query under a savepoint so one failing optional query cannot abort the whole package. */
function softRunner(sql: postgres.TransactionSql): Soft {
  return async (fallback, fn) => {
    try {
      return (await sql.savepoint((s) => fn(s))) as Awaited<ReturnType<typeof fn>>;
    } catch {
      return fallback;
    }
  };
}

type Rows = Record<string, unknown>[];

export type FunderFacts = {
  orgId: string;
  name: string;
  orgType: string | null;
  city: string | null;
  state: string | null;
  ein: string | null;
  website: string | null;
  postureWord: string | null;
};

/** Add the funder items from the corpus. Returns the basics so callers can name the funder. */
export async function addFunderEvidence(
  b: EvidenceBuilder,
  sql: postgres.TransactionSql,
  orgId: string,
): Promise<{ facts: FunderFacts; corpusItems: number }> {
  const orgRows = (await sql`
    select o.id, o.name, o.org_type, o.city, o.state, o.website, o.ntee_code, o.subsection_code,
           o.ruling_date::text as ruling_date, o.asset_amount::text as asset_amount,
           o.income_amount::text as income_amount, o.source_dataset, o.source_url
    from public.organizations o
    where o.id = ${orgId}::uuid
    limit 1`) as Rows;
  const org = orgRows[0];
  if (!org) throw new FunderNotFoundError(orgId);

  const soft = softRunner(sql);
  const einRows = await soft([] as Rows, async (s) => (await s`
    select id_value from public.org_identifiers
    where org_id = ${orgId}::uuid and id_type = 'ein'
    limit 1`) as Rows);
  const ein = str(einRows[0]?.id_value);
  const name = String(org.name ?? "Unnamed organization");
  const orgType = str(org.org_type);
  const city = str(org.city);
  const state = str(org.state);
  const bmfAssets = num(org.asset_amount);
  const bmfIncome = num(org.income_amount);

  const identityBits = [
    `${name} is a ${ORG_TYPE_WORDS[orgType ?? ""] ?? orgType ?? "organization"}` + (city || state ? ` in ${[city, state].filter(Boolean).join(", ")}` : "") + ".",
  ];
  if (ein) identityBits.push(`EIN ${ein}.`);
  if (str(org.ntee_code)) identityBits.push(`NTEE code ${str(org.ntee_code)}.`);
  if (str(org.ruling_date)) identityBits.push(`IRS ruling date ${str(org.ruling_date)}.`);
  if (bmfAssets !== null || bmfIncome !== null) {
    identityBits.push(`IRS Business Master File snapshot: assets ${moneyForModel(bmfAssets)}, income ${moneyForModel(bmfIncome)}.`);
  }
  b.add("identity", "source", "identity", identityBits.join(" "), {
    label: str(org.source_dataset) ?? "IRS Exempt Organizations BMF",
    dataset: str(org.source_dataset),
    href: str(org.source_url),
  });

  let corpusItems = 0;

  // Website stated on the latest non-superseded filing (BMF has none for most foundations).
  const siteRows = await soft([] as Rows, async (s) => (await s`
    select website, tax_period, return_type, source_dataset
    from public.filings
    where org_id = ${orgId}::uuid and superseded_by_object_id is null and website is not null and btrim(website) <> ''
    order by tax_period desc nulls last
    limit 1`) as Rows);
  const website = str(siteRows[0]?.website) ?? str(org.website);
  if (website) {
    const fy = fyOf(siteRows[0]?.tax_period);
    b.add("website", "source", "website", `Website stated by the filer: ${website}.`, {
      label: fy ? `IRS ${str(siteRows[0]?.return_type) ?? "990"} · FY${fy}` : "IRS filing",
      dataset: str(siteRows[0]?.source_dataset),
      fy,
    });
    corpusItems++;
  }

  // Latest financials (any return type, latest non-superseded filing).
  const finRows = await soft([] as Rows, async (s) => (await s`
    select fy, return_type, total_revenue::text as total_revenue, total_expenses::text as total_expenses,
           charitable_disbursements::text as charitable_disbursements,
           qualifying_distributions::text as qualifying_distributions,
           total_assets_eoy::text as total_assets_eoy, net_assets_eoy::text as net_assets_eoy,
           fmv_assets_eoy::text as fmv_assets_eoy, n_filings
    from internal.mv_org_latest_financials
    where org_id = ${orgId}::uuid
    limit 1`) as Rows);
  const fin = finRows[0];
  if (fin) {
    const fy = num(fin.fy);
    const rt = str(fin.return_type) ?? "990";
    const giving = num(fin.qualifying_distributions) ?? num(fin.charitable_disbursements);
    b.add(
      "financials",
      "source",
      "financials",
      `Latest financials (FY${fy ?? "?"}, Form ${rt}): giving paid out ${moneyForModel(giving)}; ` +
        `revenue ${moneyForModel(fin.total_revenue)}; expenses ${moneyForModel(fin.total_expenses)}; ` +
        `total assets ${moneyForModel(fin.total_assets_eoy)}; net assets ${moneyForModel(fin.net_assets_eoy)}; ` +
        `${num(fin.n_filings) ?? "?"} filings on file.`,
      { label: `IRS ${rt} · FY${fy ?? "?"}`, fy },
    );
    corpusItems++;
  }

  // Short giving series (up to five fiscal years).
  const seriesRows = await soft([] as Rows, async (s) => (await s`
    select fy, coalesce(qualifying_distributions, charitable_disbursements)::text as giving,
           total_revenue::text as total_revenue
    from public.org_financial_series
    where org_id = ${orgId}::uuid and fy is not null
    order by fy desc
    limit 5`) as Rows);
  if (seriesRows.length > 1) {
    b.add(
      "series",
      "source",
      "series",
      "Giving by year (paid out): " + seriesRows.map((r) => `FY${num(r.fy)} ${moneyForModel(r.giving)}`).join("; ") + ".",
      { label: "IRS filings · multi-year" },
    );
    corpusItems++;
  }

  // Application posture + Part XV text (990-PF filers only).
  const postureRows = await soft([] as Rows, async (s) => (await s`
    select fy, application_posture, form_and_info_txt, submission_deadlines_txt, restrictions_txt,
           app_city, app_state, source_dataset, source_url
    from public.org_application_posture
    where org_id = ${orgId}::uuid
    limit 1`) as Rows);
  const posture = postureRows[0];
  let postureWord: string | null = null;
  if (posture) {
    const key = str(posture.application_posture) ?? "unknown";
    postureWord = POSTURE_WORDS[key] ?? POSTURE_WORDS.unknown;
    const fy = num(posture.fy);
    const bits = [`Application posture (Form 990-PF FY${fy ?? "?"}, Part XV): ${postureWord}.`];
    if (key === "unknown") bits.push("This is an absence of a statement in the filing, not a refusal.");
    if (str(posture.form_and_info_txt)) bits.push(`How to apply: ${clip(posture.form_and_info_txt as string, 500)}`);
    if (str(posture.submission_deadlines_txt)) bits.push(`Deadlines: ${clip(posture.submission_deadlines_txt as string, 250)}`);
    if (str(posture.restrictions_txt)) bits.push(`Restrictions: ${clip(posture.restrictions_txt as string, 400)}`);
    if (str(posture.app_city) || str(posture.app_state)) {
      bits.push(`Application address: ${[str(posture.app_city), str(posture.app_state)].filter(Boolean).join(", ")}.`);
    }
    b.add("posture", "source", "posture_", bits.join(" "), {
      label: `IRS 990-PF · FY${fy ?? "?"} · Part XV`,
      dataset: str(posture.source_dataset),
      fy,
      href: str(posture.source_url),
    });
    corpusItems++;
  }

  // Grant statistics.
  const statRows = await soft([] as Rows, async (s) => (await s`
    select n::text as n, total::text as total, first_fy, last_fy
    from internal.mv_funder_event_stats
    where org_id = ${orgId}::uuid and event_type = 'grant'
    limit 1`) as Rows);
  const stats = statRows[0];
  const grantCount = num(stats?.n) ?? 0;
  if (stats && grantCount > 0) {
    b.add(
      "grant_stats",
      "source",
      "grant_stats",
      `Grant history on file: ${new Intl.NumberFormat("en-US").format(grantCount)} grants totaling ${moneyForModel(stats.total)} ` +
        `across FY${num(stats.first_fy) ?? "?"} to FY${num(stats.last_fy) ?? "?"}.`,
      { label: "IRS 990 / 990-PF grants · all years" },
    );
    corpusItems++;
  }

  // The largest grants with their stated purpose.
  const grantRows = await soft([] as Rows, async (s) => (await s`
    select recipient_name, recipient_city, recipient_state, amount::text as amount, fiscal_year, purpose_text,
           source_dataset, filing_object_id
    from public.funding_events
    where funder_org_id = ${orgId}::uuid and event_type = 'grant'
    order by amount desc nulls last, id
    limit 20`) as Rows);
  for (const g of grantRows) {
    const place = [str(g.recipient_city), str(g.recipient_state)].filter(Boolean).join(", ");
    const fy = num(g.fiscal_year);
    b.add(
      "grant",
      "source",
      "grant_",
      `Grant: ${moneyForModel(g.amount)} to ${str(g.recipient_name) ?? "unnamed recipient"}` +
        (place ? ` (${place})` : "") +
        (fy ? `, FY${fy}` : "") +
        (str(g.purpose_text) ? `. Purpose: ${clip(g.purpose_text as string, 200)}` : "."),
      { label: fy ? `IRS 990-PF · FY${fy}` : "IRS 990-PF", dataset: str(g.source_dataset), fy },
    );
    corpusItems++;
  }

  // Giving geography by recipient state.
  const geoRows = await soft([] as Rows, async (s) => (await s`
    select coalesce(recipient_state, '??') as state, count(*)::int as n, sum(amount)::text as total
    from public.funding_events
    where funder_org_id = ${orgId}::uuid and event_type = 'grant'
    group by 1
    order by sum(amount) desc nulls last
    limit 10`) as Rows);
  if (geoRows.length > 0) {
    b.add(
      "geography",
      "source",
      "geography",
      "Giving by recipient state: " +
        geoRows
          .map((r) => `${str(r.state) === "??" ? "unknown state" : str(r.state)}: ${moneyForModel(r.total)} across ${num(r.n) ?? 0} grants`)
          .join("; ") +
        ".",
      { label: "IRS 990 / 990-PF grants · all years" },
    );
    corpusItems++;
  }

  // Similar funders by giving behaviour (vector index: foundations, companies, advisers only).
  const similarRows = await soft([] as Rows, async (s) => (await s`
    select org_id, name, org_type, state, size_amount::text as size_amount
    from internal.similar_orgs(${orgId}::uuid, 6, null, null, null, null)`) as Rows);
  for (const sim of similarRows) {
    b.add(
      "similar",
      "source",
      "similar_",
      `Similar funder by giving behavior: ${str(sim.name) ?? "unnamed"}` +
        (str(sim.state) ? ` (${str(sim.state)})` : "") +
        (str(sim.org_type) ? `, ${ORG_TYPE_WORDS[sim.org_type as string] ?? sim.org_type}` : "") +
        ".",
      { label: "Open Funder Database · similarity" },
    );
    corpusItems++;
  }

  return { facts: { orgId, name, orgType, city, state, ein, website, postureWord }, corpusItems };
}

function fyOf(taxPeriod: unknown): number | null {
  const s = str(taxPeriod);
  if (!s) return null;
  const n = Number(s.slice(0, 4));
  return Number.isFinite(n) && n > 1900 ? n : null;
}

/**
 * Build the fit evidence package for one funder and the caller's workspace.
 * Throws `FunderNotFoundError`. Returns `thin: true` when the corpus has
 * nothing beyond identity, so the caller can refuse before spending credits.
 */
export async function buildFitEvidence(
  input: { orgId: string; workspaceId: string; userId: string },
  deps: EvidenceDeps = {},
): Promise<FitEvidencePackage> {
  if (!UUID_RE.test(input.orgId)) throw new FunderNotFoundError(input.orgId);
  const corpus = deps.corpus ?? corpusQuery;
  const wu = deps.withUser ?? withUser;

  const b = new EvidenceBuilder();
  const { facts, corpusItems } = await corpus((sql) => addFunderEvidence(b, sql, input.orgId));

  const applicant = await wu(input.userId, (sql) => loadApplicant(sql, input.workspaceId));
  const applicantName = applicant?.name ?? "Your organization";
  const { empty } = addApplicantEvidence(
    b,
    applicant ?? { name: applicantName, profile: readProfile({}), knowledge: [] },
  );

  return {
    orgId: input.orgId,
    funderName: facts.name,
    applicantName,
    items: b.items,
    thin: corpusItems === 0,
    applicantEmpty: empty,
  };
}

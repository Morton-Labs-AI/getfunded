import { sql } from "@/lib/db";

export interface OrgFull {
  id: string;
  name: string;
  legal_name: string | null;
  org_type: string;
  street: string | null;
  city: string | null;
  state: string | null;
  country: string;
  website: string | null;
  ntee_code: string | null;
  foundation_code: string | null;
  ruling_date: string | null;
  asset_amount: string | null;
  income_amount: string | null;
  revenue_amount: string | null;
  aum: string | null;
  fund_size: string | null;
  is_era: boolean | null;
  focus_areas: string[];
  status: string;
  last_verified_at: string | null;
  source_record_locator: string;
  canonical_org_id: string | null;
  // provenance (joined)
  dataset_name: string;
  source_url: string | null;
  sha256: string;
  license_name: string;
  downloaded_at: string;
}

export async function getOrg(id: string): Promise<OrgFull | null> {
  const rows = await sql<OrgFull[]>`
    select o.id, o.name, o.legal_name, o.org_type, o.street, o.city, o.state,
           o.country, o.website, o.ntee_code, o.foundation_code,
           o.ruling_date::text, o.asset_amount::text, o.income_amount::text,
           o.revenue_amount::text, o.aum::text, o.fund_size::text, o.is_era,
           o.focus_areas, o.status, o.last_verified_at::text,
           o.source_record_locator, o.canonical_org_id,
           rf.dataset_name, rf.source_url, rf.sha256, lm.license_name,
           rf.downloaded_at::text
    from internal.organizations o
    join internal.raw_files rf on rf.id = o.raw_file_id
    join internal.licensing_map lm on lm.license_code = rf.license_code
    where o.id = ${id}`;
  return rows[0] ?? null;
}

export interface MergedRecord {
  id: string;
  name: string;
  source_record_locator: string;
  dataset_name: string;
}
/** Non-canonical rows merged into this org (empty until an ER apply runs). */
export async function orgMergedRecords(id: string): Promise<MergedRecord[]> {
  return await sql<MergedRecord[]>`
    select o.id, o.name, o.source_record_locator, rf.dataset_name
    from internal.organizations o
    join internal.raw_files rf on rf.id = o.raw_file_id
    where o.canonical_org_id = ${id}
    order by rf.dataset_name, o.name`;
}

export interface IdentifierRow {
  id_type: string;
  id_value: string;
}
/** Identifier union across the canonical cluster (identity pre-apply). */
export async function orgIdentifiers(id: string): Promise<IdentifierRow[]> {
  return await sql<IdentifierRow[]>`
    select distinct id_type, id_value from internal.org_identifiers_canonical
    where org_id = ${id} order by id_type`;
}

export interface PersonChip {
  person_id: string;
  full_name: string;
  title: string | null;
  rel_type: string;
  dataset_name: string;
}
/** memberIds = the canonical org + its merged records ([id] pre-apply).
    distinct-on dedupes a person appearing via more than one member row;
    the outer order restores the role-precedence-then-name chip order. */
export async function orgPeople(memberIds: string[], limit = 40): Promise<PersonChip[]> {
  return await sql<PersonChip[]>`
    select person_id, full_name, title, rel_type, dataset_name from (
      select distinct on (p.id)
             p.id as person_id, p.full_name,
             coalesce(r.title, p.primary_title) as title,
             r.rel_type, rf.dataset_name,
             case r.rel_type when 'owner_of' then 0 when 'officer_of' then 1
               when 'trustee_of' then 2 when 'director_of' then 3 else 4 end as role_rank
      from internal.relationships r
      join internal.people p on p.id = r.from_person_id
      join internal.raw_files rf on rf.id = p.raw_file_id
      where r.to_org_id = any(${memberIds}::uuid[]) and r.from_person_id is not null
      order by p.id, case r.rel_type when 'owner_of' then 0 when 'officer_of' then 1
               when 'trustee_of' then 2 when 'director_of' then 3 else 4 end
    ) t
    order by role_rank, full_name
    limit ${limit}`;
}

export interface EventRow {
  id: string;
  event_type: string;
  recipient_name: string;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_org_id: string | null;
  amount: string | null;
  purpose_text: string | null;
  fiscal_year: number | null;
  event_date: string | null;
  source_record_locator: string;
}

export async function orgGrantsPaid(
  memberIds: string[],
  q?: string,
  limit = 25
): Promise<EventRow[]> {
  if (q?.trim()) {
    return await sql<EventRow[]>`
      select fe.id, fe.event_type, fe.recipient_name, fe.recipient_city,
             fe.recipient_state, fe.recipient_org_id, fe.amount::text,
             fe.purpose_text, fe.fiscal_year, fe.event_date::text,
             fe.source_record_locator
      from internal.funding_events fe
      where fe.funder_org_id = any(${memberIds}::uuid[])
        and fe.search_tsv @@ websearch_to_tsquery('english', ${q})
      order by fe.amount desc nulls last limit ${limit}`;
  }
  return await sql<EventRow[]>`
    select fe.id, fe.event_type, fe.recipient_name, fe.recipient_city,
           fe.recipient_state, fe.recipient_org_id, fe.amount::text,
           fe.purpose_text, fe.fiscal_year, fe.event_date::text,
           fe.source_record_locator
    from internal.funding_events fe
    where fe.funder_org_id = any(${memberIds}::uuid[])
    order by fe.amount desc nulls last limit ${limit}`;
}

/** Member-array predicate (not org_resolve coalesce) keeps the btree on
    recipient_org_id — this is what surfaces a merged fund's Form D
    offerings on the canonical page. */
export async function orgEventsReceived(memberIds: string[], limit = 25): Promise<EventRow[]> {
  return await sql<EventRow[]>`
    select fe.id, fe.event_type, fe.recipient_name, fe.recipient_city,
           fe.recipient_state, fe.recipient_org_id, fe.amount::text,
           fe.purpose_text, fe.fiscal_year, fe.event_date::text,
           fe.source_record_locator
    from internal.funding_events fe
    where fe.recipient_org_id = any(${memberIds}::uuid[])
    order by fe.event_date desc nulls last, fe.fiscal_year desc nulls last
    limit ${limit}`;
}

export interface FunderStats {
  event_type: string;
  n: string;
  total: string | null;
  first_fy: number | null;
  last_fy: number | null;
}
export async function orgFunderStats(memberIds: string[]): Promise<FunderStats[]> {
  return await sql<FunderStats[]>`
    select event_type, sum(n)::text as n, sum(total)::text as total,
           min(first_fy) as first_fy, max(last_fy) as last_fy
    from internal.mv_funder_event_stats
    where org_id = any(${memberIds}::uuid[])
    group by event_type`;
}

export interface YearBar {
  fy: number;
  n: string;
  total: string | null;
}
export async function orgGrantsByYear(memberIds: string[]): Promise<YearBar[]> {
  return await sql<YearBar[]>`
    select fiscal_year as fy, count(*)::text as n, sum(amount)::text as total
    from internal.funding_events
    where funder_org_id = any(${memberIds}::uuid[]) and fiscal_year is not null
    group by 1 order by 1`;
}

export interface FundRow {
  org_id: string;
  name: string;
  fund_size: string | null;
  focus_areas: string[];
  fund_id: string | null;
}
export async function orgFundsManaged(id: string, limit = 50): Promise<FundRow[]> {
  return await sql<FundRow[]>`
    select f.id as org_id, f.name, f.fund_size::text, f.focus_areas,
           (select i.id_value from internal.org_identifiers i
             where i.org_id = f.id and i.id_type = 'sec_private_fund_id' limit 1) as fund_id
    from internal.relationships r
    join internal.organizations f on f.id = r.to_org_id
    where r.from_org_id = ${id} and r.rel_type = 'manages_fund'
    order by f.fund_size desc nulls last limit ${limit}`;
}

export interface ManagerRow {
  org_id: string;
  name: string;
  org_type: string;
}
export async function orgManagedBy(id: string): Promise<ManagerRow[]> {
  return await sql<ManagerRow[]>`
    select a.id as org_id, a.name, a.org_type
    from internal.relationships r
    join internal.organizations a on a.id = r.from_org_id
    where r.to_org_id = ${id} and r.rel_type = 'manages_fund'`;
}

export interface ProgramCard {
  id: string;
  name: string;
  program_type: string;
  non_dilutive: boolean;
  funds_lab_not_company: boolean;
  status: string;
  url: string | null;
}
export async function orgProgramsAdministered(id: string): Promise<ProgramCard[]> {
  return await sql<ProgramCard[]>`
    select id, name, program_type, non_dilutive, funds_lab_not_company, status, url
    from internal.funding_programs where administering_org_id = ${id}
    order by name`;
}

export async function orgContactCount(id: string): Promise<number> {
  const rows = await sql`
    select count(*)::int as n from internal.contact_channels
    where org_id = ${id}
       or person_id in (select from_person_id from internal.relationships
                        where to_org_id = ${id} and from_person_id is not null)`;
  return (rows[0]?.n as number) ?? 0;
}

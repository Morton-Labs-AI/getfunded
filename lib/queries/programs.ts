import { sql } from "@/lib/db";

export interface ProgramFull {
  id: string;
  name: string;
  program_type: string;
  program_code: string | null;
  description: string | null;
  eligibility: string | null;
  award_floor: string | null;
  award_ceiling: string | null;
  non_dilutive: boolean;
  funds_lab_not_company: boolean;
  status: string;
  url: string | null;
  agency_id: string;
  agency_name: string;
  source_record_locator: string;
  dataset_name: string;
  source_url: string | null;
  sha256: string;
  license_name: string;
  downloaded_at: string;
}

export async function listPrograms(): Promise<ProgramFull[]> {
  return await sql<ProgramFull[]>`
    select fp.id, fp.name, fp.program_type, fp.program_code, fp.description,
           fp.eligibility, fp.award_floor::text, fp.award_ceiling::text,
           fp.non_dilutive, fp.funds_lab_not_company, fp.status, fp.url,
           a.id as agency_id, a.name as agency_name,
           fp.source_record_locator, rf.dataset_name, rf.source_url, rf.sha256,
           lm.license_name, rf.downloaded_at::text
    from internal.funding_programs fp
    join internal.organizations a on a.id = fp.administering_org_id
    join internal.raw_files rf on rf.id = fp.raw_file_id
    join internal.licensing_map lm on lm.license_code = rf.license_code
    order by a.name, fp.name`;
}

export async function getProgram(id: string): Promise<ProgramFull | null> {
  const rows = await sql<ProgramFull[]>`
    select fp.id, fp.name, fp.program_type, fp.program_code, fp.description,
           fp.eligibility, fp.award_floor::text, fp.award_ceiling::text,
           fp.non_dilutive, fp.funds_lab_not_company, fp.status, fp.url,
           a.id as agency_id, a.name as agency_name,
           fp.source_record_locator, rf.dataset_name, rf.source_url, rf.sha256,
           lm.license_name, rf.downloaded_at::text
    from internal.funding_programs fp
    join internal.organizations a on a.id = fp.administering_org_id
    join internal.raw_files rf on rf.id = fp.raw_file_id
    join internal.licensing_map lm on lm.license_code = rf.license_code
    where fp.id = ${id}`;
  return rows[0] ?? null;
}

export interface AwardRow {
  id: string;
  recipient_name: string;
  recipient_org_id: string | null;
  recipient_state: string | null;
  fiscal_year: number | null;
  amount: string | null;
  purpose_text: string | null;
}

export async function programAwards(id: string, limit = 25): Promise<AwardRow[]> {
  return await sql<AwardRow[]>`
    select id, recipient_name, recipient_org_id, recipient_state,
           fiscal_year, amount::text, purpose_text
    from internal.funding_events
    where program_id = ${id}
    order by fiscal_year desc nulls last, amount desc nulls last
    limit ${limit}`;
}

export interface AwardYear {
  fy: number;
  n: string;
  total: string | null;
}
export async function programAwardsByYear(id: string): Promise<AwardYear[]> {
  return await sql<AwardYear[]>`
    select fiscal_year as fy, count(*)::text as n, sum(amount)::text as total
    from internal.funding_events
    where program_id = ${id} and fiscal_year is not null
    group by 1 order by 1 desc limit 12`;
}

export async function programAwardCount(id: string): Promise<{ n: number; total: string | null }> {
  const rows = await sql`
    select count(*)::int as n, sum(amount)::text as total
    from internal.funding_events where program_id = ${id}`;
  return { n: (rows[0]?.n as number) ?? 0, total: (rows[0]?.total as string) ?? null };
}

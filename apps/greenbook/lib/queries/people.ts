import { sql } from "@/lib/db";

export interface PersonFull {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  primary_org_id: string | null;
  primary_title: string | null;
  canonical_person_id: string | null;
  source_record_locator: string;
  // primary org (joined; link id resolves to the survivor)
  primary_org_name: string | null;
  primary_org_link_id: string | null;
  // provenance (joined)
  dataset_name: string;
  source_url: string | null;
  sha256: string;
  license_name: string;
  downloaded_at: string;
}

export async function getPerson(id: string): Promise<PersonFull | null> {
  const rows = await sql<PersonFull[]>`
    select p.id, p.full_name, p.first_name, p.last_name, p.primary_org_id,
           p.primary_title, p.canonical_person_id, p.source_record_locator,
           o.name as primary_org_name,
           coalesce(o.canonical_org_id, o.id) as primary_org_link_id,
           rf.dataset_name, rf.source_url, rf.sha256, lm.license_name,
           rf.downloaded_at::text
    from internal.people p
    left join internal.organizations o on o.id = p.primary_org_id
    join internal.raw_files rf on rf.id = p.raw_file_id
    join internal.licensing_map lm on lm.license_code = rf.license_code
    where p.id = ${id}`;
  return rows[0] ?? null;
}

export interface MergedPersonRecord {
  id: string;
  full_name: string;
  source_record_locator: string;
  dataset_name: string;
}
/** Non-canonical rows merged into this person (empty until an ER apply runs). */
export async function personMergedRecords(id: string): Promise<MergedPersonRecord[]> {
  return await sql<MergedPersonRecord[]>`
    select p.id, p.full_name, p.source_record_locator, rf.dataset_name
    from internal.people p
    join internal.raw_files rf on rf.id = p.raw_file_id
    where p.canonical_person_id = ${id}
    order by rf.dataset_name, p.full_name`;
}

export interface AffiliationRow {
  org_id: string;
  name: string;
  org_type: string;
  title: string | null;
  rel_type: string;
  dataset_name: string;
  source_url: string | null;
  sha256: string;
  license_name: string;
  downloaded_at: string;
}
/** memberIds = the canonical person + its merged records ([id] pre-apply).
    Member-array predicate (not person_resolve coalesce) keeps
    ix_rel_from_person — same reasoning as orgEventsReceived's btree note.
    distinct-on the canonical-org expression dedupes an org reached via more
    than one member row AND collapses a merged org's per-source rows onto
    their survivor; the outer order restores role-precedence-then-name.
    Provenance joins follow the relationship row (the affiliation claim),
    not the person row. */
export async function personOrgs(memberIds: string[], limit = 100): Promise<AffiliationRow[]> {
  return await sql<AffiliationRow[]>`
    select org_id, name, org_type, title, rel_type, dataset_name, source_url,
           sha256, license_name, downloaded_at from (
      select distinct on (coalesce(o.canonical_org_id, o.id))
             coalesce(o.canonical_org_id, o.id) as org_id, o.name, o.org_type,
             coalesce(r.title, p.primary_title) as title,
             r.rel_type, rf.dataset_name, rf.source_url, rf.sha256,
             lm.license_name, rf.downloaded_at::text,
             case r.rel_type when 'owner_of' then 0 when 'officer_of' then 1
               when 'trustee_of' then 2 when 'director_of' then 3 else 4 end as role_rank
      from internal.relationships r
      join internal.organizations o on o.id = r.to_org_id
      join internal.people p on p.id = r.from_person_id
      join internal.raw_files rf on rf.id = r.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where r.from_person_id = any(${memberIds}::uuid[])
      order by coalesce(o.canonical_org_id, o.id),
               case r.rel_type when 'owner_of' then 0 when 'officer_of' then 1
               when 'trustee_of' then 2 when 'director_of' then 3 else 4 end
    ) t
    order by role_rank, name
    limit ${limit}`;
}

/** Count only — contact_channels.value is masked and never selected. */
export async function personContactCount(memberIds: string[]): Promise<number> {
  const rows = await sql`
    select count(*)::int as n from internal.contact_channels
    where person_id = any(${memberIds}::uuid[])`;
  return (rows[0]?.n as number) ?? 0;
}

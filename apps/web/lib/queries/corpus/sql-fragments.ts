import "server-only";

/**
 * SQL fragments shared by every corpus reader, so a doctrine is written once:
 *
 *   - `liveGrantEvents()`: THE predicate for a funder's paid grants. The
 *     funder page header ("N grants on file"), the grants table, the giving
 *     profile and the fit evidence all count the same rows, so one number
 *     appears everywhere. It excludes rows that belong to a superseded
 *     filing: when an amended return replaces an original, the amended
 *     return's grants are the ones that count, and nothing is counted twice.
 *
 *   - `rawFileHash()`: the sha256 of the file a row was parsed from, for the
 *     provenance seal. The app role may read internal.raw_files (id, sha256)
 *     only once migration getfunded_0010 is applied, so the grant is probed
 *     once per process and the column is left null (and the seal leaves the
 *     fingerprint out) until then. Deploy order therefore does not matter.
 *
 *   - `addressBasis()`: where an organization's address came from. Corpus
 *     migration 0030 adds internal.organizations.address_basis and
 *     address_object_id; `funderdb derive org-address` fills them when it
 *     copies the address from the header of the organization's latest return.
 *     The columns are probed, so a deploy before the migration reads NULL and
 *     the page shows no note.
 */
import type postgres from "postgres";

type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * WHERE predicate for one funder's paid grants. The funding_events view must
 * be aliased `pe`. Composes into a larger template: `where ${liveGrantEvents(sql, orgId)}`.
 */
export function liveGrantEvents(sql: Sql, orgId: string) {
  return sql`pe.funder_org_id = ${orgId}::uuid
    and pe.event_type = 'grant'
    and (pe.filing_object_id is null or not exists (
          select 1 from internal.filings sf
          where sf.object_id = pe.filing_object_id and sf.superseded_by_object_id is not null))`;
}

let hashReadable: boolean | null = null;

/**
 * Whether this process may read internal.raw_files (id, sha256). Probed once;
 * the probe is written so it cannot raise inside the caller's transaction.
 */
export async function canReadRawFileHash(sql: Sql): Promise<boolean> {
  if (hashReadable !== null) return hashReadable;
  try {
    const rows = await sql<{ ok: boolean | null }[]>`
      select case when to_regclass('internal.raw_files') is null then false
                  else has_column_privilege('internal.raw_files', 'sha256', 'select')
                       and has_column_privilege('internal.raw_files', 'id', 'select') end as ok`;
    hashReadable = rows[0]?.ok === true;
  } catch {
    hashReadable = false;
  }
  return hashReadable;
}

/** Test seam: forget the probe result. */
export function resetRawFileHashProbeForTests(): void {
  hashReadable = null;
}

/**
 * The two halves of a provenance-hash lookup: a `left join internal.raw_files <rf>`
 * on `<table>.<raw_file_id column>`, and the `<rf>.sha256` column (or `null::text`
 * when the grant is not there yet). Use both or neither. `rawFileIdColumn` is
 * "alias.column" from our own SQL, never user input; identifiers are quoted anyway.
 */
export function rawFileHash(sql: Sql, readable: boolean, rawFileIdColumn: string, rf = "rf") {
  const [alias, column] = rawFileIdColumn.split(".");
  return {
    join: readable ? sql`left join internal.raw_files ${sql(rf)} on ${sql(rf)}.id = ${sql(alias)}.${sql(column)}` : sql``,
    column: readable ? sql`${sql(rf)}.sha256` : sql`null::text`,
  };
}

let addressBasisReadable = false;

/**
 * Whether internal.organizations has the address_basis column (corpus
 * migration 0030) and this process may read it. A "yes" is remembered for the
 * life of the process. A "no" is asked again on the next call (one catalog
 * lookup), so the note appears as soon as the migration lands, without a
 * redeploy. The probe reads the catalog only and cannot raise inside the
 * caller's transaction.
 */
export async function canReadAddressBasis(sql: Sql): Promise<boolean> {
  if (addressBasisReadable) return true;
  try {
    const rows = await sql<{ ok: boolean | null }[]>`
      select exists (
        select 1 from pg_attribute a
        where a.attrelid = to_regclass('internal.organizations')
          and a.attname = 'address_basis' and a.attnum > 0 and not a.attisdropped
          and has_column_privilege(a.attrelid, a.attnum, 'select')) as ok`;
    addressBasisReadable = rows[0]?.ok === true;
  } catch {
    addressBasisReadable = false;
  }
  return addressBasisReadable;
}

/** Test seam: forget the probe result. */
export function resetAddressBasisProbeForTests(): void {
  addressBasisReadable = false;
}

/**
 * The two halves of the address-basis lookup for a query whose organization
 * row is aliased `o`: the columns, and a join to the return the address was
 * taken from (public.filings, so only a republishable return gives a year).
 * Use both or neither. Before the migration both columns are NULL.
 */
export function addressBasis(sql: Sql, readable: boolean) {
  return {
    join: readable ? sql`left join public.filings adf on adf.object_id = o.address_object_id` : sql``,
    columns: readable
      ? sql`o.address_basis, o.address_object_id, adf.tax_period as address_tax_period`
      : sql`null::text as address_basis, null::text as address_object_id, null::text as address_tax_period`,
  };
}

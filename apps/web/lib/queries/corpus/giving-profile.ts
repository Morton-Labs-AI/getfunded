import "server-only";

/**
 * Whether search can read the funder giving profiles (corpus 0040: where each
 * funder's grants went, by state and by the recipients' NTEE group) AND they
 * hold data. The views are created empty and filled by
 * `uv run funderdb refresh-views`, so a deployment can run long before they
 * are ready: search then ranks with what the search documents say (each
 * funder's top recipient states) and hides the two filters that need exact
 * counts. Once they are filled, the next probe (at most two minutes later)
 * switches every search to the exact counts, with no redeploy.
 *
 * The probe reads only the catalog, so it cannot raise inside the caller's
 * transaction; a "yes" is remembered for ten minutes.
 */
import type postgres from "postgres";

type Sql = postgres.Sql | postgres.TransactionSql;

export const GIVING_PROFILE_VIEWS = ["mv_funder_giving_state", "mv_funder_giving_cause", "mv_funder_grant_profile"] as const;

let readyUntil = 0;
let notReadyUntil = 0;

export async function givingProfilesReady(sql: Sql): Promise<boolean> {
  const now = Date.now();
  if (now < readyUntil) return true;
  if (now < notReadyUntil) return false;
  try {
    const rows = await sql<{ n: number; ok: boolean | null }[]>`
      select count(*)::int as n,
             bool_and(c.relispopulated and has_table_privilege(c.oid, 'select')) as ok
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'internal' and c.relkind = 'm' and c.relname = any(${[...GIVING_PROFILE_VIEWS]}::text[])`;
    const ok = rows[0]?.n === GIVING_PROFILE_VIEWS.length && rows[0]?.ok === true;
    if (ok) readyUntil = now + 10 * 60_000;
    else notReadyUntil = now + 2 * 60_000;
    return ok;
  } catch {
    notReadyUntil = now + 60_000;
    return false;
  }
}

/** Test seam. */
export function resetGivingProfilesProbeForTests(): void {
  readyUntil = 0;
  notReadyUntil = 0;
}

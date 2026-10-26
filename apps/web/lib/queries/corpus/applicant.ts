import "server-only";

/**
 * The applicant's own IRS record, found by EIN: what onboarding and Settings
 * fill into blank profile fields (lib/workspace/search-profile.ts
 * fillFromRecord). Read-only, one row. Never throws: a lookup that fails or
 * finds nothing simply fills nothing.
 */
import { corpusQuery } from "@/lib/db/corpus";
import type { ApplicantRecord } from "@/lib/workspace/search-profile";

export async function readApplicantRecord(ein: string | null | undefined): Promise<ApplicantRecord | null> {
  const digits = (ein ?? "").replace(/\D/g, "");
  if (digits.length !== 9) return null;
  try {
    const rows = await corpusQuery(
      (sql) => sql<{ name: string; city: string | null; state: string | null; ntee_code: string | null; revenue: string | null }[]>`
        select o.name, o.city, o.state, o.ntee_code, coalesce(o.revenue_amount, o.income_amount)::text as revenue
        from public.org_identifiers oi
        join internal.organizations o on o.id = oi.org_id
        where oi.id_type = 'ein' and oi.id_value = ${digits}::text and o.canonical_org_id is null
        order by (o.org_type = 'public_charity') desc, o.id
        limit 1`,
      { timeoutMs: 5_000 },
    );
    const r = rows[0];
    if (!r) return null;
    const revenue = r.revenue === null ? null : Number(r.revenue);
    return { name: r.name, city: r.city, state: r.state, nteeCode: r.ntee_code, revenue: revenue !== null && Number.isFinite(revenue) ? revenue : null };
  } catch (err) {
    console.warn("[applicant] IRS record lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

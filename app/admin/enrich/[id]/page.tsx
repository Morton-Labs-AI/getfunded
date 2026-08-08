import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { EnrichFlow } from "@/components/admin/enrich-flow";

export const dynamic = "force-dynamic";

interface OrgRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  org_type: string;
}

interface ExistingRow {
  website_url: string;
  extracted_at: string;
}

/** Dev-only enrichment console (reads via funder_ro; writes go through the
    admin routes, which enforce the localhost/dev guards). */
export default async function EnrichPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const [orgs, existing] = await Promise.all([
    sql<OrgRow[]>`
      select id, name, city, state, org_type
      from internal.organizations where id = ${id}`,
    sql<ExistingRow[]>`
      select website_url, extracted_at::text
      from internal.org_web_facts
      where org_id = ${id} and status = 'confirmed'`,
  ]);
  const org = orgs[0];
  if (!org) notFound();

  return (
    <div className="page-enter mx-auto w-full max-w-[860px] px-6 pb-16 pt-10">
      <span className="mono-label">
        website enrichment · dev only ·{" "}
        {[org.city, org.state].filter(Boolean).join(", ") || "—"}
      </span>
      <h1 className="mt-2 text-[24px] font-[650] leading-8 tracking-[-0.02em] text-ink-1">
        {org.name}
      </h1>
      <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-ink-3">
        Fetches the foundation&rsquo;s own website (robots-respecting, seed page
        plus up to five About/Grants/Team pages), snapshots it into raw_files,
        and extracts structured facts for review. Nothing reaches the profile
        until you confirm; snapshots and extracted facts are internal-only and
        never enter public exports.
      </p>
      <EnrichFlow
        orgId={org.id}
        orgName={org.name}
        orgState={org.state}
        existingUrl={existing[0]?.website_url ?? null}
      />
    </div>
  );
}

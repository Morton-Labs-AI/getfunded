import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ orgs: [], programs: [] });

  if (q.length < 3) {
    const orgs = await sql`
      select id, name, org_type, state,
             coalesce(asset_amount, aum, fund_size)::text as size
      from internal.organizations
      where name_normalized like ${q.toUpperCase() + "%"}
        and canonical_org_id is null
      order by coalesce(asset_amount, aum, fund_size) desc nulls last
      limit 8`;
    return Response.json({ orgs, programs: [] });
  }

  const [fts, programs] = await Promise.all([
    sql`
      select o.id, o.name, o.org_type, o.state,
             coalesce(o.asset_amount, o.aum, o.fund_size)::text as size
      from internal.organizations o, websearch_to_tsquery('english', ${q}) query
      where o.search_tsv @@ query and o.canonical_org_id is null
      order by ts_rank_cd(o.search_tsv, query) desc,
               coalesce(o.asset_amount, o.aum, o.fund_size) desc nulls last
      limit 8`,
    sql`
      select fp.id, fp.name
      from internal.funding_programs fp
      where fp.search_tsv @@ websearch_to_tsquery('english', ${q})
      limit 4`,
  ]);

  let orgs = fts;
  if (orgs.length < 3) {
    const trgm = await sql`
      select o.id, o.name, o.org_type, o.state,
             coalesce(o.asset_amount, o.aum, o.fund_size)::text as size
      from internal.organizations o
      where o.name % ${q} and o.canonical_org_id is null
      order by similarity(o.name, ${q}) desc
      limit 8`;
    const seen = new Set(orgs.map((r) => r.id));
    orgs = [...orgs, ...trgm.filter((r) => !seen.has(r.id))].slice(0, 8);
  }

  return Response.json({ orgs, programs });
}

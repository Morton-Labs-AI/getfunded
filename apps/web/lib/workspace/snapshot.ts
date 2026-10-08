import "server-only";

import { z } from "zod";

import { corpusQuery } from "@/lib/db/corpus";

import type { FunderSnapshot } from "./types";

/**
 * The corpus snapshot a saved funder carries (name, EIN, type, city, state,
 * website). Read from the license-filtered public views through the
 * read-only corpus transaction. Search's `getFunder()` returns the same
 * identity block; this small reader keeps the workspace self-sufficient when a
 * funder is saved from a place that does not already hold the record.
 */

const uuid = z.uuid();

type OrgRow = {
  id: string;
  name: string | null;
  org_type: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  ein: string | null;
};

export async function getFunderSnapshot(orgId: string): Promise<FunderSnapshot | null> {
  const id = uuid.safeParse(orgId);
  if (!id.success) return null;
  const rows = await corpusQuery((sql) =>
    sql<OrgRow[]>`
      select o.id, o.name, o.org_type, o.city, o.state, o.website,
             (select i.id_value from public.org_identifiers i
               where i.org_id = o.id and i.id_type = 'ein'
               order by i.confidence desc nulls last limit 1) as ein
      from public.organizations o
      where o.id = ${id.data}::uuid
      limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    orgId: row.id,
    name: row.name ?? "Unnamed organization",
    ein: row.ein ?? null,
    orgType: row.org_type ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    website: row.website ?? null,
  };
}

/** Stored on `saved_funders.snapshot` as snake_case, the same shape the demo seed writes. */
export function snapshotToJson(s: FunderSnapshot): Record<string, string | null> {
  return { name: s.name, ein: s.ein, org_type: s.orgType, city: s.city, state: s.state, website: s.website };
}

export function snapshotFromJson(orgId: string, raw: unknown): FunderSnapshot {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string): string | null => (typeof r[k] === "string" && (r[k] as string).length > 0 ? (r[k] as string) : null);
  return {
    orgId,
    name: str("name") ?? "Unnamed organization",
    ein: str("ein"),
    orgType: str("org_type") ?? str("orgType"),
    city: str("city"),
    state: str("state"),
    website: str("website"),
  };
}

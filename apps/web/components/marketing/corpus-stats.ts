import "server-only";

import { cacheLife } from "next/cache";

import { corpusQuery } from "@/lib/db/corpus";
import { toNumber } from "@/lib/format";

/**
 * Live coverage numbers for the marketing site, read from the corpus plane's
 * materialized views and cached for hours. The function never throws: when
 * the database is unreachable (no DATABASE_URL at build time, a network
 * blip, a timeout) it returns null and the page shows fallback copy with no
 * numbers in it. Nothing here reads a request, so it can sit in the static
 * shell.
 */

export const POSTURE_KEYS = ["open", "preselected_only", "unknown"] as const;
export type PostureKey = (typeof POSTURE_KEYS)[number];

export type CorpusStats = {
  /** Organizations in the corpus (every exempt org in the BMF spine plus SEC/SBA entities). */
  orgs: number | null;
  /** Funding events: grants, commitments, awards and Reg D offerings. */
  events: number | null;
  /** People rows (per source, not yet resolved across sources). */
  people: number | null;
  /** When the materialized views were last refreshed, ISO 8601. */
  refreshedAt: string | null;
  /** Foundations by application posture, from their latest parsed 990-PF. */
  posture: Record<PostureKey, number | null>;
  /** Organizations by type, largest first. */
  orgTypes: Array<{ orgType: string; n: number }>;
  /** Public contact channels (role inboxes and phones with publishability = 'public'). */
  publicContacts: number | null;
};

type TotalsRow = { orgs: unknown; events: unknown; people: unknown; refreshed_at: unknown };
type PostureRow = { application_posture: unknown; n: unknown };
type TypeRow = { org_type: unknown; n: unknown };
type CountRow = { n: unknown };

function isoOrNull(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === "string" && v.trim() !== "") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export async function getCorpusStats(): Promise<CorpusStats | null> {
  "use cache";
  cacheLife("hours");

  try {
    return await corpusQuery(async (sql) => {
      const totals = await sql<TotalsRow[]>`
        select orgs, events, people, refreshed_at
        from internal.mv_overview_totals
        limit 1
      `;
      const posture = await sql<PostureRow[]>`
        select application_posture, count(*)::bigint as n
        from internal.mv_org_application_posture
        group by application_posture
      `;
      const types = await sql<TypeRow[]>`
        select org_type, n
        from internal.mv_org_type_counts
        order by n desc
      `;
      const contacts = await sql<CountRow[]>`
        select count(*)::bigint as n
        from public.contact_channels
      `;

      const t = totals[0];
      const postureCounts: Record<PostureKey, number | null> = { open: null, preselected_only: null, unknown: null };
      for (const row of posture) {
        const key = String(row.application_posture);
        if ((POSTURE_KEYS as readonly string[]).includes(key)) {
          postureCounts[key as PostureKey] = toNumber(row.n as string | number | null);
        }
      }

      return {
        orgs: t ? toNumber(t.orgs as string | number | null) : null,
        events: t ? toNumber(t.events as string | number | null) : null,
        people: t ? toNumber(t.people as string | number | null) : null,
        refreshedAt: t ? isoOrNull(t.refreshed_at) : null,
        posture: postureCounts,
        orgTypes: types
          .map((row) => ({ orgType: String(row.org_type), n: toNumber(row.n as string | number | null) }))
          .filter((row): row is { orgType: string; n: number } => row.n !== null),
        publicContacts: contacts[0] ? toNumber(contacts[0].n as string | number | null) : null,
      } satisfies CorpusStats;
    });
  } catch {
    return null;
  }
}

/** Plain-language names for `organizations.org_type`. */
export const ORG_TYPE_LABELS: Record<string, string> = {
  public_charity: "Public charities",
  private_foundation: "Private foundations",
  fund: "Private funds (SEC Form D and ADV)",
  company: "Companies",
  investment_adviser: "Investment advisers",
  pe: "Private equity advisers",
  vc: "Venture capital advisers",
  gov_agency: "Federal agencies",
};

export function orgTypeLabel(orgType: string): string {
  return ORG_TYPE_LABELS[orgType] ?? orgType.replace(/_/g, " ");
}

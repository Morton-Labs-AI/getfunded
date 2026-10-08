import "server-only";

import { cacheLife } from "next/cache";

import { corpusQuery } from "@/lib/db/corpus";
import { toNumber } from "@/lib/format";

/**
 * Private foundations per state, for the "Browse without downloading" grid on
 * /foundations. Read from the corpus plane's `internal.mv_org_state_counts`
 * (columns: state, org_type, n) and cached for hours, the same way
 * components/marketing/corpus-stats.ts reads the coverage numbers.
 *
 * The function never throws. When the database is unreachable (no
 * DATABASE_URL at build time, a network blip, a timeout) or the view is
 * empty, it returns null and the grid renders without numbers: we never show
 * a stale or made-up count, and an empty view is not "zero foundations".
 * Nothing here reads a request, so it can sit in the static shell.
 */

/** State code (upper case) → number of private foundations. */
export type FoundationStateCounts = Record<string, number>;

type StateRow = { state: unknown; n: unknown };

export async function getFoundationStateCounts(): Promise<FoundationStateCounts | null> {
  "use cache";
  cacheLife("hours");

  try {
    return await corpusQuery(async (sql) => {
      const rows = await sql<StateRow[]>`
        select state, n
        from internal.mv_org_state_counts
        where org_type = 'private_foundation'
      `;
      const counts: FoundationStateCounts = {};
      for (const row of rows) {
        const n = toNumber(row.n as string | number | null);
        if (typeof row.state === "string" && row.state.trim() !== "" && n !== null) {
          counts[row.state.trim().toUpperCase()] = n;
        }
      }
      return Object.keys(counts).length > 0 ? counts : null;
    });
  } catch {
    return null;
  }
}

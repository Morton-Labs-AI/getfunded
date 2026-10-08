import "server-only";

import { cache } from "react";

import { withUser } from "@/lib/db/app";

import { type Banner, type Flags, flagsFromRows } from "./flags";

/**
 * Flags, read anonymously: `p_flags_select` is `using (true)`, so no user is
 * needed. Cached per request. Never throws: a database that is down or not
 * configured yields the defaults (AI on, sign-ups open, no banner), which is
 * the safe direction for a marketing page.
 */
export const getFlags = cache(async (): Promise<Flags> => {
  try {
    const rows = await withUser(null, (sql) =>
      sql<{ key: string; value: unknown }[]>`
        select key, value from getfunded.flags where key in ('ai_enabled', 'signup_mode', 'banner')`,
    );
    return flagsFromRows(rows);
  } catch {
    return flagsFromRows([]);
  }
});

/** The site banner for <SiteBanner />, or null. */
export async function getSiteBanner(): Promise<Banner | null> {
  return (await getFlags()).banner;
}

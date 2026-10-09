import postgres from "postgres";

/**
 * The APPLICATION pool — hand-written queries only.
 *
 * Connected as community_app: SELECT on the corpus (internal.*), full DML on
 * the membership layer (community.*). ONE role holds both because every
 * personalized surface is corpus ⋈ community in a single SQL statement; two
 * pools would push those joins into Node and break /browse's keyset cursor.
 * That much is dnw-funder-intelligence's lib/db.ts, verbatim.
 *
 * DELIBERATE DIFF from lib/db.ts: NO default_transaction_read_only — this pool
 * writes community.*. Corpus safety is structural (community_app holds zero
 * write grants on internal.*), which is stronger than a connection parameter:
 * a parameter can be stripped by the pooler, overridden by a SET, or dropped in
 * an env edit. A missing grant cannot. scripts/db-ping.mjs asserts the absence
 * on every run.
 *
 * WHY THIS IS A SECOND POOL AND NOT A REPLACEMENT FOR lib/db.ts:
 * lib/ai/tools.ts runs tx.unsafe(<model output>) on lib/db.ts's pool, and
 * lib/ai/sql-guard.ts allows any `select` with no schema restriction — its own
 * comment names funder_ro's SELECT-only grants as safety layer 3 of 4. Giving
 * that pool write grants would delete half of layer 3; giving it any privilege
 * in `community` would put `select email from community.members` one model turn
 * from the chat pane. funder_ro therefore holds NOTHING here, not even USAGE,
 * and the two pools are split by WHO AUTHORED THE SQL rather than by read/write.
 *
 * FALLBACK: with COMMUNITY_DATABASE_URL unset this falls back to DATABASE_URL,
 * so `next build` succeeds and every existing corpus page renders exactly as
 * today on a deployment that has not had the operator step. Community reads
 * then soft-fail to empty panels and community WRITES fail loudly with
 * "permission denied for schema community" rather than silently succeeding
 * against the wrong role.
 */
const globalForCommunityDb = globalThis as unknown as {
  ofdbCommunitySql?: ReturnType<typeof postgres>;
};

/**
 * `??` is WRONG here and this is not a style preference: it falls back only on
 * null/undefined, and .env.example ships `COMMUNITY_DATABASE_URL=` — an EMPTY
 * STRING. With `??` the pool is handed "" and postgres.js quietly falls back to
 * libpq defaults, so the failure surfaces as `password authentication failed
 * for user "<your-unix-username>"` instead of the intended `permission denied
 * for schema community`. Both are loud; only one points at the real problem.
 */
function envUrl(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : undefined;
}

/** True only when the dedicated community_app connection is configured. */
export const communityEnabled = Boolean(envUrl("COMMUNITY_DATABASE_URL"));

export const communitySql =
  globalForCommunityDb.ofdbCommunitySql ??
  postgres(envUrl("COMMUNITY_DATABASE_URL") ?? envUrl("DATABASE_URL")!, {
    max: 6,
    idle_timeout: 30,
    connect_timeout: 10,
    connection: {
      application_name: "ofdb-community",
      statement_timeout: 15000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForCommunityDb.ofdbCommunitySql = communitySql;
}

/**
 * Community panels degrade to nothing; they never 500 a corpus page.
 *
 * This is lib/queries/org-profile.ts's orgWebFacts idiom promoted to a helper,
 * and it is what makes the whole feature shippable mid-migration: with the
 * community schema absent, /org/[id] renders byte-identically to today.
 * Deliberately NOT used for writes — a failed write must reach the caller.
 */
export async function softFail<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[community softFail]", e instanceof Error ? e.message : e);
    }
    return fallback;
  }
}

/**
 * Write paths call this first, so a misconfigured deploy fails at the door with
 * a sentence an operator can act on instead of a Postgres permission error
 * three frames deep.
 */
export function assertCommunityPool(): void {
  if (!communityEnabled) {
    throw new Error(
      "COMMUNITY_DATABASE_URL is not set — community writes are disabled. " +
        "See .env.example; the role is community_app (migration community_0001)."
    );
  }
}

import "server-only";

import { communitySql } from "@/lib/community/db";

/**
 * THE ONLY WAY TO QUERY community.* — no exceptions.
 *
 * RLS policies (community_0005) read the member identity from
 * current_setting('app.member_id'), so every statement that touches the
 * membership layer must run inside a transaction that has set it.
 *
 * WHY set_config(..., true) AND NOT A SESSION SET:
 * the third argument is is_local. TRUE scopes the value to the TRANSACTION, so
 * it reverts on COMMIT or ROLLBACK. That is what makes this safe on a pooled
 * connection: postgres.js hands the same physical connection to the next
 * request, and a SESSION-level SET (is_local = false) would still be sitting
 * there — the next member's queries would run as the previous member. That bug
 * is invisible in development, where you are the only user.
 *
 * FAIL-CLOSED BY CONSTRUCTION: an anonymous caller passes null, which becomes
 * the empty string, which community.current_member_id() maps to NULL, which
 * every policy predicate rejects. A query that forgets this wrapper entirely
 * runs with no member context and returns ZERO ROWS — never another member's.
 * The failure direction is the only acceptable one.
 */
export async function asMember<T>(
  memberId: string | null,
  fn: (tx: typeof communitySql) => Promise<T>
): Promise<T> {
  return communitySql.begin(async (tx) => {
    await tx`select set_config('app.member_id', ${memberId ?? ""}, true)`;
    return fn(tx as unknown as typeof communitySql);
  }) as Promise<T>;
}

/**
 * Read-only variant for community panels hanging off a corpus page. Same
 * identity scoping; degrades to `fallback` instead of throwing, because a
 * community panel must never 500 an org page.
 *
 * Deliberately NOT used for writes — a failed write has to reach the caller.
 */
export async function asMemberSoft<T>(
  memberId: string | null,
  fallback: T,
  fn: (tx: typeof communitySql) => Promise<T>
): Promise<T> {
  try {
    return await asMember(memberId, fn);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[asMemberSoft]", e instanceof Error ? e.message : e);
    }
    return fallback;
  }
}

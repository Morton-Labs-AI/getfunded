/**
 * Pure steward logic, shared by lib/admin/gate.ts (pages, actions, routes)
 * and its tests. No server imports here.
 *
 * A user is a steward when EITHER
 *   - `getfunded.users.is_steward` is true (what Row Level Security reads), OR
 *   - their email is in `ADMIN_EMAILS` (the operator's bootstrap list).
 *
 * The database flag is what makes cross-workspace reads work, so a listed
 * user whose flag is still false is promoted on first visit through the
 * `getfunded.claim_steward(emails[])` door, which promotes the caller only.
 */
import { adminEmails, isAdminEmail, type Env } from "@/lib/auth/identity";

export type StewardInput = {
  email: string;
  /** `users.is_steward`, or null when the users row does not exist yet. */
  flagged: boolean | null;
};

export type StewardDecision = {
  /** May open /admin. */
  allowed: boolean;
  /** Listed in ADMIN_EMAILS. */
  listed: boolean;
  /** `users.is_steward` is true (RLS honours it). */
  flagged: boolean;
  /** Listed but not yet flagged: call `claim_steward` with `claimEmails`. */
  needsClaim: boolean;
  claimEmails: string[];
};

export function decideSteward(input: StewardInput, env: Env = process.env): StewardDecision {
  const listed = isAdminEmail(input.email, env);
  const flagged = input.flagged === true;
  const needsClaim = listed && !flagged;
  return {
    allowed: listed || flagged,
    listed,
    flagged,
    needsClaim,
    claimEmails: needsClaim ? adminEmails(env) : [],
  };
}

export type StewardSession = {
  user: { id: string; email: string; displayName: string | null };
  listed: boolean;
  /** True after the claim ran (or was already true). False means RLS still hides other workspaces. */
  flagged: boolean;
};

export type StewardDbDeps = {
  /** `select is_steward from getfunded.users where id = userId` under RLS; null when no row. */
  readFlag: (userId: string) => Promise<boolean | null>;
  /** `select getfunded.claim_steward($emails)` as the user. */
  claim: (userId: string, emails: string[]) => Promise<boolean>;
  env?: Env;
};

/**
 * Resolve a signed-in user to a steward session, or null when they are not
 * a steward. Runs the one-time claim for listed users whose flag is false.
 */
export async function resolveSteward(
  user: StewardSession["user"],
  deps: StewardDbDeps,
): Promise<StewardSession | null> {
  const env = deps.env ?? process.env;
  let flag: boolean | null = null;
  try {
    flag = await deps.readFlag(user.id);
  } catch {
    flag = null;
  }
  const decision = decideSteward({ email: user.email, flagged: flag }, env);
  if (!decision.allowed) return null;
  let flagged = decision.flagged;
  if (decision.needsClaim) {
    try {
      flagged = await deps.claim(user.id, decision.claimEmails);
    } catch {
      flagged = false;
    }
  }
  return { user, listed: decision.listed, flagged };
}

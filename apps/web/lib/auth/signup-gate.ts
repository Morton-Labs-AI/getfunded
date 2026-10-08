import { getFlags } from "@/lib/admin/flags-server";
import type { Flags, SignupMode } from "@/lib/admin/flags";
import { withUser } from "@/lib/db/app";

/**
 * The sign-up gate: enforces the steward flag `signup_mode` the moment an
 * account would be CREATED (`getfunded.provision_user`), not just in the
 * sign-in form. The form's `shouldCreateUser` is a courtesy that keeps the
 * auth server from minting accounts nobody can use; this is the rule.
 *
 *   open    anyone may sign up (the default when the flag row is absent)
 *   invite  a NEW account is provisioned only when a pending invite names its
 *           email (`getfunded.has_pending_invite`, migration 0011)
 *   closed  no new accounts at all
 *
 * Existing accounts always pass: the gate is about creation, never a lockout.
 * `decideSignup` is pure and tested; `assertSignupAllowed` wires the flags and
 * the two database reads through injectable deps. In `open` mode it costs
 * nothing beyond the request-cached flags read.
 */

export type SignupRefusal = "signups_closed" | "invite_required";

export class SignupRefusedError extends Error {
  readonly code: SignupRefusal;
  readonly status = 403;
  constructor(code: SignupRefusal) {
    super(
      code === "signups_closed"
        ? "New accounts are paused on this deployment."
        : "New accounts are by invitation on this deployment, and no pending invitation names this email.",
    );
    this.name = "SignupRefusedError";
    this.code = code;
  }
  static is(error: unknown): error is SignupRefusedError {
    return error instanceof SignupRefusedError;
  }
}

export type SignupDecisionInput = {
  mode: SignupMode;
  /** A `getfunded.users` row already exists for this auth user. */
  exists: boolean;
  /** A pending invite names this email (only consulted in `invite` mode). */
  hasInvite: boolean;
};

/** Null when provisioning may proceed, else the reason it may not. */
export function decideSignup(input: SignupDecisionInput): SignupRefusal | null {
  if (input.mode === "open") return null;
  if (input.exists) return null;
  if (input.mode === "closed") return "signups_closed";
  return input.hasInvite ? null : "invite_required";
}

export type SignupGateDeps = {
  getFlags?: () => Promise<Flags>;
  userExists?: (userId: string) => Promise<boolean>;
  hasPendingInvite?: (email: string) => Promise<boolean>;
};

/** `select 1 from getfunded.users where id = $1` as the user (RLS lets a user see their own row). */
async function defaultUserExists(userId: string): Promise<boolean> {
  return withUser(userId, async (sql) => {
    const rows = await sql`select 1 as ok from getfunded.users where id = ${userId}::uuid`;
    return rows.length > 0;
  });
}

/** The 0011 door; anonymous (the callback often has no users row yet). */
async function defaultHasPendingInvite(email: string): Promise<boolean> {
  return withUser(null, async (sql) => {
    const rows = await sql<{ ok: boolean }[]>`select getfunded.has_pending_invite(${email.trim().toLowerCase()}) as ok`;
    return rows[0]?.ok === true;
  });
}

/**
 * Throws `SignupRefusedError` when this user has no account yet and the
 * sign-up mode does not admit them. Resolves otherwise.
 */
export async function assertSignupAllowed(user: { id: string; email: string }, deps: SignupGateDeps = {}): Promise<void> {
  const flags = await (deps.getFlags ?? getFlags)();
  if (flags.signupMode === "open") return;
  const exists = await (deps.userExists ?? defaultUserExists)(user.id);
  if (exists) return;
  const hasInvite = flags.signupMode === "invite" ? await (deps.hasPendingInvite ?? defaultHasPendingInvite)(user.email) : false;
  const refusal = decideSignup({ mode: flags.signupMode, exists, hasInvite });
  if (refusal) throw new SignupRefusedError(refusal);
}

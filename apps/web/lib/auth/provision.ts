import type postgres from "postgres";
import { z } from "zod";

import { withUser } from "@/lib/db/app";

import { assertSignupAllowed } from "./signup-gate";

/**
 * First-sign-in provisioning through `getfunded.provision_user()`.
 *
 * ONE SECURITY DEFINER call, not a hand-rolled transaction. Provisioning
 * inserts the very rows an RLS policy would test against (the user, the
 * personal workspace and the owner membership), so it cannot run under
 * policy; doing it in Postgres also makes it atomic by construction. The
 * function is idempotent: an existing user gets `is_new = false` and their
 * existing personal workspace back.
 *
 * The sign-up gate (`./signup-gate`) runs first: when the steward flag
 * `signup_mode` is `closed` or `invite`, a user with no account yet is refused
 * with `SignupRefusedError` before any row is written. It lives HERE, not only
 * in the auth callback, because every path that can create an account
 * (callback, requireWorkspace, the admin gate) goes through this function.
 *
 * Not a trigger on `auth.users`: a trigger failure would abort Supabase's own
 * sign-up transaction and take sign-in down for everyone.
 */

const provisionInputSchema = z.object({
  id: z.uuid(),
  email: z.email().max(254),
  displayName: z.string().trim().max(120).nullable().optional(),
});

export type ProvisionInput = z.input<typeof provisionInputSchema>;

export type Provisioned = { userId: string; workspaceId: string; isNew: boolean };

type ProvisionRow = { user_id: string; workspace_id: string; is_new: boolean };

/** The transaction runner; injectable so tests can pass a fake `sql`. */
export type UserRunner = <T>(
  userId: string | null,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

/** The sign-up gate; throws `SignupRefusedError` for a new account the flag does not admit. */
export type SignupGate = (user: { id: string; email: string }) => Promise<void>;

export async function ensureProvisioned(
  user: ProvisionInput,
  deps: { withUser?: UserRunner; gate?: SignupGate } = {},
): Promise<Provisioned> {
  const input = provisionInputSchema.parse(user);
  const run = deps.withUser ?? withUser;
  const email = input.email.toLowerCase();
  const displayName = input.displayName && input.displayName.length > 0 ? input.displayName : null;

  await (deps.gate ?? assertSignupAllowed)({ id: input.id, email });

  const rows = await run(input.id, (sql) =>
    sql<ProvisionRow[]>`
      select user_id, workspace_id, is_new
      from getfunded.provision_user(${input.id}::uuid, ${email}, ${displayName})`,
  );

  const row = rows[0];
  if (!row) {
    throw new Error("getfunded.provision_user returned no row. Are the getfunded migrations applied?");
  }
  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    isNew: Boolean(row.is_new),
  };
}

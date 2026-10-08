import "server-only";

import { cookies } from "next/headers";
import type postgres from "postgres";
import { cache } from "react";
import { z } from "zod";

import { ensureProvisioned } from "@/lib/auth/provision";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db/app";

/**
 * Active workspace selection.
 *
 * A user can belong to several workspaces. The one they are working in is
 * remembered in the `gf_ws` cookie, and the cookie is never trusted on its
 * own: every read re-checks membership with `getfunded.is_member()` inside
 * `withUser()`, and a stale or forged value silently falls back to the user's
 * first workspace.
 */

export const WORKSPACE_COOKIE = "gf_ws";

export const PLANS = ["free", "starter", "pro", "team", "enterprise", "unlimited"] as const;
export type Plan = (typeof PLANS)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * `workspaces.profile`: what the fit engine reads as "the applicant". Loose so
 * keys added by other features survive a round trip through this module.
 */
export const workspaceProfileSchema = z.looseObject({
  mission: z.string().max(4000).optional(),
  /** Nine digits, no dash. Render with `formatEin`. */
  ein: z.string().regex(/^\d{9}$/).optional(),
  website: z.string().max(500).optional(),
  /** Two-letter USPS code. */
  state: z.string().length(2).optional(),
  counties: z.array(z.string().max(120)).max(200).optional(),
  program_areas: z.array(z.string().max(120)).max(100).optional(),
  /** Whole dollars. */
  annual_budget: z.number().int().nonnegative().optional(),
  populations_served: z.array(z.string().max(120)).max(100).optional(),
  keywords: z.array(z.string().max(120)).max(200).optional(),
});
export type WorkspaceProfile = z.infer<typeof workspaceProfileSchema>;

export const workspaceSettingsSchema = z.looseObject({
  daily_cap_enabled: z.boolean().optional(),
  default_stage: z.string().max(40).optional(),
  timezone: z.string().max(80).optional(),
});
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  plan: Plan;
  profile: WorkspaceProfile;
  settings: WorkspaceSettings;
  /** The signed-in user's role in this workspace. */
  role: MemberRole;
  /** Compare-and-swap version for updates (`where id = $1 and version = $2`). */
  version: number;
};

type WorkspaceRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  profile: unknown;
  settings: unknown;
  role: string;
  version: number;
};

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super("No workspace found for this user.");
    this.name = "WorkspaceNotFoundError";
  }
}

const uuidSchema = z.uuid();

function parseWorkspaceId(value: string | undefined): string | null {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  const plan = PLANS.includes(row.plan as Plan) ? (row.plan as Plan) : "free";
  const role = MEMBER_ROLES.includes(row.role as MemberRole) ? (row.role as MemberRole) : "member";
  const profile = workspaceProfileSchema.safeParse(row.profile ?? {});
  const settings = workspaceSettingsSchema.safeParse(row.settings ?? {});
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    plan,
    profile: profile.success ? profile.data : {},
    settings: settings.success ? settings.data : {},
    role,
    version: Number(row.version),
  };
}

/**
 * The user's workspaces, membership-checked by RLS AND by `is_member()`.
 * `workspaceId` narrows to one; null returns all, oldest membership first.
 */
function selectWorkspaces(sql: postgres.TransactionSql, userId: string, workspaceId: string | null) {
  return sql<WorkspaceRow[]>`
    select w.id, w.slug, w.name, w.plan, w.profile, w.settings, w.version, m.role
    from getfunded.workspaces w
    join getfunded.members m on m.workspace_id = w.id and m.user_id = ${userId}::uuid
    where w.deleted_at is null
      and getfunded.is_member(w.id)
      ${workspaceId ? sql`and w.id = ${workspaceId}::uuid` : sql``}
    order by m.created_at asc, w.created_at asc`;
}

/**
 * The workspace the user is working in: the `gf_ws` cookie when it names a
 * workspace they belong to, else their first workspace. Throws
 * `WorkspaceNotFoundError` for a user with no membership at all (which
 * `ensureProvisioned()` prevents).
 */
export const getActiveWorkspace = cache(async (userId: string): Promise<Workspace> => {
  const store = await cookies();
  const requested = parseWorkspaceId(store.get(WORKSPACE_COOKIE)?.value);

  return withUser(userId, async (sql) => {
    if (requested) {
      const rows = await selectWorkspaces(sql, userId, requested);
      if (rows[0]) return toWorkspace(rows[0]);
    }
    const rows = await selectWorkspaces(sql, userId, null);
    const row = rows[0];
    if (!row) throw new WorkspaceNotFoundError();
    return toWorkspace(row);
  });
});

/** Every workspace the user belongs to, for a switcher. */
export const listWorkspaces = cache(async (userId: string): Promise<Workspace[]> => {
  return withUser(userId, async (sql) => {
    const rows = await selectWorkspaces(sql, userId, null);
    return rows.map(toWorkspace);
  });
});

export type SetActiveWorkspaceResult = { ok: true } | { ok: false; error: string };

/**
 * Server Action: remember `workspaceId` as the active workspace. Verifies the
 * caller is signed in and a member before writing the cookie. Import this
 * from a Server Component and pass it to a form or client component; this
 * module itself is server-only.
 */
export async function setActiveWorkspace(workspaceId: string): Promise<SetActiveWorkspaceResult> {
  "use server";

  const parsed = uuidSchema.safeParse(workspaceId);
  if (!parsed.success) return { ok: false, error: "That workspace id is not valid." };

  const user = await requireUser();
  const isMember = await withUser(user.id, async (sql) => {
    const rows = await sql<{ ok: boolean }[]>`select getfunded.is_member(${parsed.data}::uuid) as ok`;
    return Boolean(rows[0]?.ok);
  });
  if (!isMember) return { ok: false, error: "You are not a member of that workspace." };

  const store = await cookies();
  store.set(WORKSPACE_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}

/**
 * Everything a workspace page needs: the signed-in user (or a redirect to
 * sign in), their provisioned account, and the active workspace. Cached per
 * request so a layout and its page share one round of queries.
 */
export const requireWorkspace = cache(async (): Promise<{ user: SessionUser; workspace: Workspace }> => {
  const user = await requireUser();
  await ensureProvisioned(user);
  const workspace = await getActiveWorkspace(user.id);
  return { user, workspace };
});

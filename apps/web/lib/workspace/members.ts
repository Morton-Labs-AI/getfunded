import "server-only";

import { run, type Deps } from "./sql";
import type { Member, WorkspaceCtx } from "./types";

type MemberRow = { id: string; email: string; display_name: string | null; role: string };

/** Everyone in the workspace, for owner and assignee pickers. Owners first, then by name. */
export async function listMembers(ctx: WorkspaceCtx, deps?: Deps): Promise<Member[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<MemberRow[]>`
      select u.id, u.email, u.display_name, m.role
      from getfunded.members m
      join getfunded.users u on u.id = m.user_id
      where m.workspace_id = ${ctx.workspaceId}::uuid
      order by (m.role = 'owner') desc, (m.role = 'admin') desc, coalesce(u.display_name, u.email) asc`;
    return rows.map((r) => ({
      id: r.id,
      name: r.display_name?.trim() || r.email.split("@")[0],
      email: r.email,
      role: r.role === "owner" || r.role === "admin" ? r.role : "member",
    }));
  });
}

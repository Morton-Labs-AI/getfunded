"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActiveViewer } from "@/lib/auth/viewer";
import { asMember } from "@/lib/community/session";
import { assertCommunityPool } from "@/lib/community/db";

import type { ActionResult } from "./collections";

/**
 * Following a funder.
 *
 * PRIVACY NOTE, because it is the point rather than a detail: a follow row is
 * readable only by its owner (p_follows_read), unless that member has
 * deliberately set follows_public — which defaults to FALSE. Which funders a
 * development director tracks is competitive intelligence about their
 * organization's fundraising strategy, and getting that default wrong once is
 * not recoverable. Public follower COUNTS come from community.org_stats(),
 * which returns numbers and never identities.
 */
const FollowSchema = z.object({ orgId: z.string().uuid() }).strict();

export async function toggleFollowOrg(
  input: unknown
): Promise<ActionResult<{ following: boolean }>> {
  const viewer = await requireActiveViewer().catch(() => null);
  if (!viewer) return { error: "Sign in to follow funders." };

  const parsed = FollowSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not update that follow." };
  const { orgId } = parsed.data;

  try {
    assertCommunityPool();
    const following = await asMember(viewer.memberId, async (tx) => {
      const removed = await tx`
        delete from community.follows
        where follower_member_id = ${viewer.memberId}::uuid
          and target_org_id = ${orgId}::uuid
        returning id`;
      if (removed.length > 0) return false;

      // Snapshot the name, and follow the SURVIVING row for the same reason
      // saveToCollectionCore does: the org page redirects a merged org to its
      // canonical id, so a follow on the merged-away row would be orphaned.
      const [org] = await tx<{ id: string; name: string }[]>`
        select coalesce(o.canonical_org_id, o.id) as id, o.name
        from internal.organizations o
        where o.id = ${orgId}::uuid`;
      if (!org) throw new Error("That organization isn't in the database.");

      await tx`
        insert into community.follows
          (follower_member_id, target_type, target_org_id, target_org_name)
        values (${viewer.memberId}::uuid, 'org', ${org.id}::uuid, ${org.name})
        on conflict do nothing`;
      return true;
    });

    revalidatePath(`/org/${orgId}`);
    return { ok: true, following };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not update that follow." };
  }
}

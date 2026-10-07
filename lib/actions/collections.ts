"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActiveViewer } from "@/lib/auth/viewer";
import { asMember } from "@/lib/community/session";
import { assertCommunityPool } from "@/lib/community/db";
import { saveToCollectionCore } from "@/lib/community/save";

/**
 * Collection writes.
 *
 * THE TEMPLATE, followed by every action in this directory with no exceptions
 * (dnw-funder-intelligence/lib/actions/saved.ts is the source):
 *   requireActiveViewer() -> zod parse -> ONE transaction -> revalidatePath ->
 *   typed Result.
 *
 * Results are RETURNED, never thrown, so the client renders an inline message
 * instead of tripping an error boundary and losing the page.
 *
 * Why Server Actions rather than route handlers: lib/admin/guard.ts had to
 * hand-roll a sec-fetch-site check because HTTP handlers accept cross-site form
 * POSTs. Actions get framework origin checking for free, and these writes come
 * from signed-in strangers rather than a local operator — hand-rolled CSRF on N
 * endpoints is N chances to forget.
 */
export type ActionResult<T = object> = ({ ok: true } & T) | { error: string };

const SaveSchema = z
  .object({
    orgId: z.string().uuid(),
    collectionId: z.string().uuid().nullable().default(null),
  })
  .strict();

export async function saveOrg(input: unknown): Promise<
  ActionResult<{ itemId: string; collectionId: string; collectionName: string; inserted: boolean }>
> {
  const viewer = await requireActiveViewer().catch(() => null);
  if (!viewer) return { error: "Sign in to save funders." };

  const parsed = SaveSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not save that funder." };

  try {
    assertCommunityPool();
    const res = await asMember(viewer.memberId, (tx) =>
      saveToCollectionCore(tx, {
        memberId: viewer.memberId,
        orgId: parsed.data.orgId,
        collectionId: parsed.data.collectionId,
      })
    );
    revalidatePath(`/org/${parsed.data.orgId}`);
    revalidatePath("/collections");
    return { ok: true, ...res };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save that funder." };
  }
}

const UnsaveSchema = z.object({ orgId: z.string().uuid() }).strict();

export async function unsaveOrg(input: unknown): Promise<ActionResult> {
  const viewer = await requireActiveViewer().catch(() => null);
  if (!viewer) return { error: "Sign in to manage your lists." };

  const parsed = UnsaveSchema.safeParse(input);
  if (!parsed.success) return { error: "Could not remove that funder." };

  try {
    assertCommunityPool();
    await asMember(viewer.memberId, async (tx) => {
      // No `owner_member_id = me` predicate is written here BECAUSE RLS
      // supplies it: p_ci_delete requires ownership of the parent collection.
      // Deliberate — the guarantee is structural, not a clause someone can
      // forget on the next query.
      await tx`
        delete from community.collection_items ci
        using community.collections c
        where c.id = ci.collection_id
          and ci.org_id = ${parsed.data.orgId}::uuid`;
    });
    revalidatePath(`/org/${parsed.data.orgId}`);
    revalidatePath("/collections");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not remove that funder." };
  }
}

const CreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable().default(null),
    visibility: z.enum(["private", "unlisted", "members", "public"]).default("private"),
  })
  .strict();

export async function createCollection(
  input: unknown
): Promise<ActionResult<{ collectionId: string }>> {
  const viewer = await requireActiveViewer().catch(() => null);
  if (!viewer) return { error: "Sign in to make a list." };

  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { error: "Give the list a name (120 characters or fewer)." };

  try {
    assertCommunityPool();
    const id = await asMember(viewer.memberId, async (tx) => {
      // Slug uniqueness is per owner (uq_cm_coll_slug), so two members may both
      // have a "Rural Health" list without colliding.
      const [row] = await tx<{ id: string }[]>`
        insert into community.collections (owner_member_id, name, slug, description, visibility)
        values (${viewer.memberId}::uuid, ${parsed.data.name},
                community.norm_slug(${parsed.data.name}),
                ${parsed.data.description}, ${parsed.data.visibility})
        returning id`;
      return row.id;
    });
    revalidatePath("/collections");
    return { ok: true, collectionId: id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("uq_cm_coll_slug")) return { error: "You already have a list with that name." };
    return { error: "Could not create that list." };
  }
}

const VisibilitySchema = z
  .object({
    collectionId: z.string().uuid(),
    visibility: z.enum(["private", "unlisted", "members", "public"]),
  })
  .strict();

export async function setCollectionVisibility(input: unknown): Promise<ActionResult> {
  const viewer = await requireActiveViewer().catch(() => null);
  if (!viewer) return { error: "Sign in to change a list." };

  const parsed = VisibilitySchema.safeParse(input);
  if (!parsed.success) return { error: "Could not update that list." };

  try {
    assertCommunityPool();
    await asMember(viewer.memberId, async (tx) => {
      // p_collections_update scopes this to the owner; a forged collectionId
      // matches zero rows rather than someone else's list.
      await tx`
        update community.collections
        set visibility = ${parsed.data.visibility}
        where id = ${parsed.data.collectionId}::uuid`;
    });
    revalidatePath("/collections");
    revalidatePath(`/collections/${parsed.data.collectionId}`);
    return { ok: true };
  } catch {
    return { error: "Could not update that list." };
  }
}

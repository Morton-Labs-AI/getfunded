import "server-only";

import { asMemberSoft } from "@/lib/community/session";

/**
 * Collection reads.
 *
 * Everything here goes through community.v_collection_item_summary — the
 * dnw.v_saved_funder_summary analogue — rather than re-deriving corpus
 * semantics per page. That view is where "a grant is not a grant commitment"
 * and "all corpus joins are LEFT so off-corpus items still render" are decided,
 * once.
 *
 * No `where owner_member_id = $me` appears in these queries. That is not an
 * omission: p_collections_read supplies it, and a forged id matches zero rows
 * rather than someone else's list. The guarantee is structural.
 */
export type CollectionSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: "private" | "unlisted" | "members" | "public";
  isDefault: boolean;
  itemCount: number;
  updatedAt: string;
  ownerHandle: string | null;
  isMine: boolean;
};

export type CollectionItem = {
  id: string;
  orgId: string | null;
  orgName: string;
  orgNameLive: string | null;
  ein: string | null;
  orgType: string | null;
  city: string | null;
  state: string | null;
  note: string | null;
  applicationPosture: string | null;
  grantsTotal: string | null;
  grantsN: number | null;
  grantsLastFy: number | null;
  totalAssetsEoy: string | null;
  createdAt: string;
};

export async function myCollections(viewerMemberId: string): Promise<CollectionSummary[]> {
  return asMemberSoft(viewerMemberId, [], async (tx) => {
    const rows = await tx<
      {
        id: string; name: string; slug: string; description: string | null;
        visibility: CollectionSummary["visibility"]; is_default: boolean;
        item_count: number; updated_at: string; owner_handle: string | null;
        owner_member_id: string;
      }[]
    >`
      select c.id, c.name, c.slug, c.description, c.visibility, c.is_default,
             c.updated_at::text,
             m.handle as owner_handle,
             c.owner_member_id,
             (select count(*)::int from community.collection_items ci
               where ci.collection_id = c.id) as item_count
      from community.collections c
      left join community.members m on m.id = c.owner_member_id
      where c.archived_at is null
        and c.owner_member_id = ${viewerMemberId}::uuid
      order by c.is_default desc, c.updated_at desc`;

    return rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, description: r.description,
      visibility: r.visibility, isDefault: r.is_default, itemCount: r.item_count,
      updatedAt: r.updated_at, ownerHandle: r.owner_handle,
      isMine: r.owner_member_id === viewerMemberId,
    }));
  });
}

export async function getCollection(
  collectionId: string,
  viewerMemberId: string | null
): Promise<{ summary: CollectionSummary; items: CollectionItem[] } | null> {
  return asMemberSoft(viewerMemberId, null, async (tx) => {
    // RLS decides visibility. A private list belonging to someone else simply
    // is not here, which the caller renders as notFound().
    const [c] = await tx<
      {
        id: string; name: string; slug: string; description: string | null;
        visibility: CollectionSummary["visibility"]; is_default: boolean;
        updated_at: string; owner_handle: string | null; owner_member_id: string;
      }[]
    >`
      select c.id, c.name, c.slug, c.description, c.visibility, c.is_default,
             c.updated_at::text, m.handle as owner_handle, c.owner_member_id
      from community.collections c
      left join community.members m on m.id = c.owner_member_id
      where c.id = ${collectionId}::uuid and c.archived_at is null`;
    if (!c) return null;

    const items = await tx<
      {
        id: string; org_id: string | null; org_name: string; org_name_live: string | null;
        ein: string | null; org_type: string | null; city: string | null; state: string | null;
        note: string | null; application_posture: string | null; grants_total: string | null;
        grants_n: number | null; grants_last_fy: number | null;
        total_assets_eoy: string | null; created_at: string;
      }[]
    >`
      select id, org_id, org_name, org_name_live, ein, org_type, city, state, note,
             application_posture,
             grants_total::text, grants_n, grants_last_fy,
             total_assets_eoy::text,
             created_at::text
      from community.v_collection_item_summary
      where collection_id = ${collectionId}::uuid
      order by position nulls last, created_at`;

    return {
      summary: {
        id: c.id, name: c.name, slug: c.slug, description: c.description,
        visibility: c.visibility, isDefault: c.is_default, itemCount: items.length,
        updatedAt: c.updated_at, ownerHandle: c.owner_handle,
        isMine: c.owner_member_id === viewerMemberId,
      },
      items: items.map((r) => ({
        id: r.id, orgId: r.org_id, orgName: r.org_name, orgNameLive: r.org_name_live,
        ein: r.ein, orgType: r.org_type, city: r.city, state: r.state, note: r.note,
        applicationPosture: r.application_posture, grantsTotal: r.grants_total,
        grantsN: r.grants_n, grantsLastFy: r.grants_last_fy,
        totalAssetsEoy: r.total_assets_eoy, createdAt: r.created_at,
      })),
    };
  });
}

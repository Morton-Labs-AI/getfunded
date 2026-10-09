import "server-only";

import { asMemberSoft } from "@/lib/community/session";

/**
 * Everything the org page needs from the community layer, in ONE round trip.
 *
 * app/org/[id]/page.tsx already runs 20+ queries across three Promise.all
 * blocks. This adds exactly one line to that page and one query to that count —
 * not five — which is why the shape below is a single statement with CTEs
 * rather than a handful of tidy little functions.
 *
 * It soft-fails to EMPTY, following lib/queries/org-profile.ts's orgWebFacts
 * ("soft-fails to null so the profile never depends on it"). That property is
 * what makes the whole feature shippable mid-migration: with the community
 * schema absent, or the pool unconfigured, /org/[id] renders exactly as it does
 * today.
 *
 * NOTE ON orgIds: the org page resolves an entity-resolution CLUSTER (it calls
 * this list `memberIds`, meaning merged org ids — nothing to do with community
 * members). Community rows may point at any id in the cluster, so every lookup
 * is `= any(orgIds)` and the counts are summed across it. Getting this wrong
 * means a member's saved funder silently vanishes the day ER merges it.
 */
export type CommunityNote = {
  id: string;
  body: string;
  kind: string;
  basis: string | null;
  basisDetail: string | null;
  occurredOn: string | null;
  createdAt: string;
  authorHandle: string | null;
  authorName: string | null;
  isMine: boolean;
};

export type ViewerCollectionRef = { id: string; name: string; itemId: string };

export type OrgCommunity = {
  followersN: number;
  sharedNotesN: number;
  taggersN: number;
  collectionsN: number;
  topTags: string[];
  viewerFollows: boolean;
  viewerCollections: ViewerCollectionRef[];
  notes: CommunityNote[];
};

/** Frozen so a caller cannot mutate the shared empty state into a real one. */
export const EMPTY_ORG_COMMUNITY: OrgCommunity = Object.freeze({
  followersN: 0,
  sharedNotesN: 0,
  taggersN: 0,
  collectionsN: 0,
  topTags: Object.freeze([]) as unknown as string[],
  viewerFollows: false,
  viewerCollections: Object.freeze([]) as unknown as ViewerCollectionRef[],
  notes: Object.freeze([]) as unknown as CommunityNote[],
});

type Row = {
  followers_n: number;
  shared_notes_n: number;
  taggers_n: number;
  collections_n: number;
  top_tags: string[];
  viewer_follows: boolean;
  viewer_collections: ViewerCollectionRef[];
  notes: CommunityNote[];
};

export async function orgCommunity(
  orgIds: string[],
  viewerMemberId: string | null
): Promise<OrgCommunity> {
  if (orgIds.length === 0) return EMPTY_ORG_COMMUNITY;

  return asMemberSoft(viewerMemberId, EMPTY_ORG_COMMUNITY, async (tx) => {
    const rows = await tx<Row[]>`
      with
      -- Aggregates come from the SECURITY DEFINER function, never from a
      -- direct count: under RLS a plain count over community.follows returns
      -- the number of times *the viewer* follows this org (one or zero), not
      -- the number of members who do.
      stats as (
        select * from community.org_stats(${orgIds}::uuid[])
      ),
      agg as (
        select
          coalesce(sum(s.followers_n), 0)::int    as followers_n,
          coalesce(sum(s.shared_notes_n), 0)::int as shared_notes_n,
          coalesce(sum(s.taggers_n), 0)::int      as taggers_n,
          coalesce(sum(s.collections_n), 0)::int  as collections_n,
          coalesce(
            (select array_agg(distinct tag)
               from stats s2, unnest(s2.top_tags) as tag),
            array[]::text[]
          ) as top_tags
        from stats s
      ),
      -- Viewer-scoped reads go through RLS normally: with no member context
      -- these are empty, which is the correct signed-out answer.
      mine as (
        select exists (
          select 1 from community.follows f
          where f.follower_member_id = ${viewerMemberId}::uuid
            and f.target_org_id = any(${orgIds}::uuid[])
        ) as viewer_follows
      ),
      cols as (
        select coalesce(json_agg(
                 json_build_object('id', c.id, 'name', c.name, 'itemId', ci.id)
                 order by c.is_default desc, c.name
               ), '[]'::json) as viewer_collections
        from community.collection_items ci
        join community.collections c on c.id = ci.collection_id
        where ci.org_id = any(${orgIds}::uuid[])
          and c.owner_member_id = ${viewerMemberId}::uuid
      ),
      shared as (
        select coalesce(json_agg(n order by n.created_at desc), '[]'::json) as notes
        from (
          select n.id, n.body, n.kind, n.basis,
                 n.basis_detail as "basisDetail",
                 n.occurred_on::text as "occurredOn",
                 n.created_at::text  as "createdAt",
                 m.handle       as "authorHandle",
                 m.display_name as "authorName",
                 (n.author_member_id = ${viewerMemberId}::uuid) as "isMine",
                 n.created_at
          from community.notes n
          left join community.members m on m.id = n.author_member_id
          where n.org_id = any(${orgIds}::uuid[])
            and n.redacted_at is null
            and n.visibility in ('members','public')
          order by n.created_at desc
          limit 25
        ) n
      )
      select agg.followers_n, agg.shared_notes_n, agg.taggers_n,
             agg.collections_n, agg.top_tags,
             mine.viewer_follows, cols.viewer_collections, shared.notes
      from agg, mine, cols, shared`;

    const r = rows[0];
    if (!r) return EMPTY_ORG_COMMUNITY;

    return {
      followersN: r.followers_n,
      sharedNotesN: r.shared_notes_n,
      taggersN: r.taggers_n,
      collectionsN: r.collections_n,
      topTags: r.top_tags ?? [],
      viewerFollows: r.viewer_follows,
      viewerCollections: r.viewer_collections ?? [],
      notes: r.notes ?? [],
    };
  });
}

/**
 * Browse-page annotation: which of these org ids the viewer has saved.
 *
 * A SEPARATE query, deliberately NOT a join into browseOrgs. lib/queries/
 * browse.ts carries an explicit warning that a non-1:1 join corrupts its keyset
 * cursor, and browseOrgs runs on the read-only corpus pool which must not learn
 * about member data at all. A post-hoc `= any($1)` over <= 50 uuids is
 * index-only and leaves browse.ts completely untouched.
 */
export async function savedOrgIds(
  viewerMemberId: string | null,
  orgIds: string[]
): Promise<Set<string>> {
  if (!viewerMemberId || orgIds.length === 0) return new Set();

  return asMemberSoft(viewerMemberId, new Set<string>(), async (tx) => {
    const rows = await tx<{ org_id: string }[]>`
      select distinct ci.org_id
      from community.collection_items ci
      join community.collections c on c.id = ci.collection_id
      where c.owner_member_id = ${viewerMemberId}::uuid
        and ci.org_id = any(${orgIds}::uuid[])`;
    return new Set(rows.map((r) => r.org_id));
  });
}

import "server-only";

import type { communitySql } from "@/lib/community/db";

/**
 * THE shared save path. dnw-funder-intelligence/lib/prospect/save.ts is the
 * model, and its reason for existing applies verbatim: the Server Action and
 * any future machine endpoint must call ONE function, or the snapshot columns,
 * the default-collection creation and the follow side-effect drift apart and
 * two code paths quietly disagree about what "saved" means.
 *
 * This is also where the "double connection" stops being an architecture
 * diagram: a SELECT against internal.organizations and an INSERT into
 * community.collection_items happen in the SAME STATEMENT SEQUENCE on the same
 * connection, because community_app spans both schemas. Two pools would have
 * forced this into Node.
 *
 * THE SNAPSHOT IS NOT DENORMALIZATION. org_id is a soft reference with no
 * foreign key (the corpus re-ingests and rewrites rows), so org_name/ein/
 * org_type/city/state are captured here at save time and travel with the row.
 * They are what lets an item still render after the corpus renames or merges
 * the org, and the EIN is the reconciliation key for the day ER rewrites
 * canonical_org_id.
 */
export type SaveResult = {
  itemId: string;
  collectionId: string;
  collectionName: string;
  inserted: boolean;
};

export async function saveToCollectionCore(
  tx: typeof communitySql,
  opts: {
    memberId: string;
    orgId: string;
    collectionId?: string | null;
  }
): Promise<SaveResult> {
  const { memberId, orgId } = opts;

  // Corpus read. community_app holds SELECT on internal.* and no write grant
  // whatsoever, so this direction is the only one that exists.
  const orgs = await tx<
    {
      id: string;
      name: string;
      org_type: string | null;
      city: string | null;
      state: string | null;
      canonical_org_id: string | null;
      ein: string | null;
    }[]
  >`
    select o.id, o.name, o.org_type, o.city, o.state, o.canonical_org_id,
           (select i.id_value from internal.org_identifiers i
             where i.org_id = o.id and i.id_type = 'ein' limit 1) as ein
    from internal.organizations o
    where o.id = ${orgId}::uuid`;

  const org = orgs[0];
  if (!org) throw new Error("That organization isn't in the database.");

  // Save against the SURVIVING row. app/org/[id]/page.tsx already redirects a
  // merged org to its canonical id, so saving the merged-away row would create
  // an item that becomes invisible the moment the reader follows that redirect.
  const targetOrgId = org.canonical_org_id ?? org.id;

  // The implicit destination: one default list per member, created on first
  // save so the Save button never has to ask "which list?" first.
  let collectionId = opts.collectionId ?? null;
  let collectionName = "";

  if (collectionId) {
    const owned = await tx<{ id: string; name: string }[]>`
      select id, name from community.collections
      where id = ${collectionId}::uuid and owner_member_id = ${memberId}::uuid`;
    if (!owned[0]) throw new Error("That list doesn't exist.");
    collectionName = owned[0].name;
  } else {
    const existing = await tx<{ id: string; name: string }[]>`
      select id, name from community.collections
      where owner_member_id = ${memberId}::uuid and is_default
      limit 1`;
    if (existing[0]) {
      collectionId = existing[0].id;
      collectionName = existing[0].name;
    } else {
      const [created] = await tx<{ id: string; name: string }[]>`
        insert into community.collections
          (owner_member_id, name, slug, is_default, visibility)
        values (${memberId}::uuid, 'Saved', 'saved', true, 'private')
        returning id, name`;
      collectionId = created.id;
      collectionName = created.name;
    }
  }

  // uq_cm_ci_org makes re-saving idempotent rather than an error: a member who
  // clicks Save twice has expressed one intention, not triggered a fault.
  const [item] = await tx<{ id: string; inserted: boolean }[]>`
    insert into community.collection_items
      (collection_id, org_id, org_name, ein, org_type, city, state, added_by)
    values (${collectionId}::uuid, ${targetOrgId}::uuid, ${org.name}, ${org.ein},
            ${org.org_type}, ${org.city}, ${org.state}, ${memberId}::uuid)
    on conflict (collection_id, org_id) where org_id is not null
    do update set updated_at = now()
    returning id, (xmax = 0) as inserted`;

  return {
    itemId: item.id,
    collectionId: collectionId!,
    collectionName,
    inserted: item.inserted,
  };
}

import postgres from "postgres";
import { readFileSync } from "node:fs";

/**
 * npm run community:verify
 *
 * Applies community_0003/0004/0005 from disk into a transaction, exercises the
 * RLS and definer boundaries with two real members, and ROLLS BACK. Nothing is
 * ever committed.
 *
 * It reads the migration FILES rather than a copy, so what is tested is exactly
 * what is in the repo. Run it before applying, and again after any policy edit —
 * the isolation guarantees here are not the kind you want to verify by reading.
 *
 * Requires ADMIN_DATABASE_URL (it must create schema objects and switch roles).
 */

const sql = postgres(process.env.ADMIN_DATABASE_URL, {
  max: 1, connect_timeout: 15,
  connection: { application_name: "ofdb-verify-phase2", statement_timeout: "60000" },
});

const read = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");
const out = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  out.push({ ok, name, got, want });
};
class Rollback extends Error {}

const A = "aaaaaaaa-0000-0000-0000-00000000000a";
const B = "bbbbbbbb-0000-0000-0000-00000000000b";

try {
  await sql.begin(async (tx) => {
    // Before the migrations are applied, replay them here so the behaviour can
    // be validated pre-flight. Afterwards, run the SAME assertions against the
    // live schema — which is the more valuable mode: this becomes a standing
    // regression test that the isolation guarantees still hold after any policy
    // edit, rather than a one-shot pre-apply check.
    const [applied] = await tx`
      select to_regclass('community.collections') is not null as yes`;
    if (applied.yes) {
      out.push({ ok: true, name: "MODE: asserting against the LIVE schema", got: "live", want: "live" });
    } else {
      for (const f of ["community_0003_collections_follows_notes_tags.sql",
                       "community_0004_views.sql",
                       "community_0005_rls.sql"]) {
        await tx.unsafe(read(f));
        out.push({ ok: true, name: `applied ${f} (pre-flight)`, got: "ok", want: "ok" });
      }
    }

    const [org] = await tx`select id, name from internal.organizations limit 1`;

    // --- seed two active members (as owner; RLS bypassed here) ---
    for (const [id, h] of [[A, "alpha"], [B, "bravo"]]) {
      await tx`insert into community.members (id, auth_user_id, handle, display_name, status,
                 license_grant, license_granted_at, tos_version, visibility)
               values (${id}::uuid, gen_random_uuid(), ${h}, ${h}, 'active',
                       'cc0_contributor', now(), 'v1', 'members')`;
    }

    const asMember = async (mid, fn) => {
      await tx.unsafe(`set local role community_app`);
      await tx`select set_config('app.member_id', ${mid ?? ""}, true)`;
      try { return await fn(); } finally { await tx.unsafe(`reset role`); }
    };

    // ================= A writes =================
    await asMember(A, async () => {
      await tx`insert into community.collections (owner_member_id, name, slug, is_default, visibility)
               values (${A}::uuid, 'Saved', 'saved', true, 'private')`;
      const [c] = await tx`select id from community.collections where owner_member_id = ${A}::uuid`;
      await tx`insert into community.collection_items (collection_id, org_id, org_name, added_by)
               values (${c.id}::uuid, ${org.id}::uuid, ${org.name}, ${A}::uuid)`;
      await tx`insert into community.follows (follower_member_id, target_type, target_org_id, target_org_name)
               values (${A}::uuid, 'org', ${org.id}::uuid, ${org.name})`;
      await tx`insert into community.notes (author_member_id, org_id, org_name, body, visibility)
               values (${A}::uuid, ${org.id}::uuid, ${org.name}, 'A private scratch note', 'private')`;
      await tx`insert into community.notes (author_member_id, org_id, org_name, body, visibility, basis, occurred_on)
               values (${A}::uuid, ${org.id}::uuid, ${org.name}, 'They do not take unsolicited proposals.',
                       'members', 'applied_and_heard_back', '2026-03-01')`;
    });

    // ================= B reads =================
    await asMember(B, async () => {
      const [r] = await tx`select
        (select count(*)::int from community.collections)                                as sees_collections,
        (select count(*)::int from community.collection_items)                           as sees_items,
        (select count(*)::int from community.follows)                                    as sees_follows,
        (select count(*)::int from community.notes where visibility = 'private')         as sees_private_notes,
        (select count(*)::int from community.notes where visibility = 'members')         as sees_shared_notes`;
      check("B cannot see A's private collection", r.sees_collections, 0);
      check("B cannot see items of a private collection", r.sees_items, 0);
      check("B cannot see A's follow rows", r.sees_follows, 0);
      check("B cannot see A's private note", r.sees_private_notes, 0);
      check("B CAN see A's shared note", r.sees_shared_notes, 1);

      // the decisive definer-boundary probe
      const [s] = await tx`select followers_n, shared_notes_n, collections_n
                           from community.org_stats(array[${org.id}]::uuid[])`;
      check("org_stats counts A's follow despite RLS", s.followers_n, 1);
      check("org_stats counts the shared note", s.shared_notes_n, 1);
      check("org_stats excludes PRIVATE collections", s.collections_n, 0);
    });

    // ================= anonymous =================
    await asMember(null, async () => {
      const [r] = await tx`select
        (select count(*)::int from community.collections)                        as cols,
        (select count(*)::int from community.notes where visibility='members')   as members_notes`;
      check("anonymous sees no collections (fail-closed)", r.cols, 0);
      check("anonymous sees no members-only notes", r.members_notes, 0);
    });

    // ================= A still sees its own =================
    await asMember(A, async () => {
      const [r] = await tx`select
        (select count(*)::int from community.collections) as cols,
        (select count(*)::int from community.notes)       as notes`;
      check("A sees its own collection", r.cols, 1);
      check("A sees both of its own notes", r.notes, 2);
    });

    // ================= the CRITICAL fix: provision_member =================
    await tx`insert into community.invites (email) values ('newbie@example.org')`;
    const authId = "cccccccc-0000-0000-0000-00000000000c";
    const p1 = await tx`select * from community.provision_member(${authId}::uuid, 'Newbie@Example.ORG ')`;
    check("provision_member succeeds (42702 fixed)", p1.length, 1);
    check("provision_member reports is_new", p1[0]?.is_new, true);
    check("provision_member status = invited", p1[0]?.status, "invited");
    const p2 = await tx`select * from community.provision_member(${authId}::uuid, 'newbie@example.org')`;
    check("provision_member is idempotent", p2[0]?.is_new, false);
    const p3 = await tx`select * from community.provision_member(gen_random_uuid(), 'stranger@nowhere.test')`;
    check("provision_member refuses a stranger (0 rows)", p3.length, 0);

    // ================= claim_invite must ignore a REVOKED invite =================
    // signup_mode is restored by the rollback along with everything else.
    await tx`insert into community.members (id, auth_user_id, handle, display_name, status,
               license_grant, license_granted_at, tos_version)
             values ('dddddddd-0000-0000-0000-00000000000d'::uuid, gen_random_uuid(), 'inviter','Inviter','active',
                     'cc0_contributor', now(), 'v1')`;
    await tx`insert into community.allowlist_domains (domain) values ('example.net')`;
    await tx`update community.settings set value = '"allowlist"'::jsonb where key = 'signup_mode'`;
    await tx`insert into community.invites (email, invited_by, revoked_at)
             values ('revoked@example.net', 'dddddddd-0000-0000-0000-00000000000d'::uuid, now())`;
    const authId2 = "eeeeeeee-0000-0000-0000-00000000000e";
    await tx`select * from community.provision_member(${authId2}::uuid, 'revoked@example.net')`;
    const [m2] = await tx`select invited_by from community.members where auth_user_id = ${authId2}::uuid`;
    check("revoked invite does NOT stamp invited_by", m2?.invited_by, null);

    // ================= member_by_auth_user works under RLS =================
    // Resolve the auth id AS OWNER first. Doing it in a subquery inside the
    // member context would itself be filtered by p_members_read (alpha is
    // visibility='members', which requires a member context) — that is correct
    // behaviour for anonymous callers, and it would make this a test of the
    // subquery rather than of the function.
    const [alpha] = await tx`select auth_user_id from community.members where handle = 'alpha'`;
    await asMember(null, async () => {
      const rows = await tx`select * from community.member_by_auth_user(${alpha.auth_user_id}::uuid)`;
      check("member_by_auth_user works with NO member context (getViewer path)", rows.length, 1);
      check("member_by_auth_user returns the right member", rows[0]?.handle, "alpha");
      // and the direct read it replaces must be blocked, or the definer
      // indirection would be pointless
      const direct = await tx`select id from community.members where auth_user_id = ${alpha.auth_user_id}::uuid`;
      check("the direct read it replaces IS blocked by RLS", direct.length, 0);
    });

    // ================= maintainer plane =================
    // Probe the CAPABILITY first: a failed SET ROLE aborts the whole
    // transaction, so this cannot be done with try/catch.
    const [ca] = await tx`select coalesce(bool_or(m.set_option), false) as can_set
      from pg_auth_members m
      join pg_roles r on r.oid = m.roleid
      join pg_roles g on g.oid = m.member
      where r.rolname = 'funder_rw' and g.rolname = current_user`;

    if (ca.can_set) {
      await tx.unsafe(`set local role funder_rw`);
      const [fr] = await tx`select
        (select count(*)::int from community.collections) as cols,
        (select count(*)::int from community.notes)       as notes,
        (select count(*)::int from community.invites)     as invites`;
      await tx.unsafe(`reset role`);
      check("funder_rw sees all collections", fr.cols, 1);
      check("funder_rw sees all notes", fr.notes, 2);
      check("funder_rw can read invites", fr.invites >= 1, true);
    } else {
      // postgres holds ADMIN on funder_rw but NOT SET (set_option = false) --
      // the same gap 0001 fixes for community_app. Assert the policies EXIST
      // and say plainly that the behavioural half is unverified.
      const [pc] = await tx`select count(*)::int as n from pg_policies
                            where schemaname = 'community' and policyname like '%_maintainer'`;
      check("maintainer policies exist on all 11 tables", pc.n, 11);
      out.push({ ok: true, name: "SKIPPED: funder_rw behaviour (postgres lacks SET on funder_rw)", got: "skipped", want: "skipped" });
    }

    throw new Rollback();
  });
} catch (e) {
  if (!(e instanceof Rollback)) { console.error("\nHARNESS ERROR:", e.message); await sql.end(); process.exit(2); }
}

await sql.end();
let bad = 0;
for (const r of out) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.ok ? "" : `  (got ${JSON.stringify(r.got)}, want ${JSON.stringify(r.want)})`}`);
}
console.log(`\n${out.length - bad}/${out.length} passed`);
process.exit(bad ? 1 : 0);

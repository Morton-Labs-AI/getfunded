#!/usr/bin/env node
/**
 * Demo seed for self-hosted installs (never production).
 *
 *   node --env-file=.env.local scripts/seed-demo.mjs --owner you@example.org
 *   node --env-file=.env.local scripts/seed-demo.mjs --remove
 *
 * Creates one workspace "Demo Food Bank" (slug demo-food-bank) with a profile,
 * three saved funders chosen from the corpus by EIN (the three largest private
 * foundations by assets in public.organizations), and two tasks. Everything is
 * labelled demo: settings.demo = true on the workspace, the 'demo' tag on each
 * saved funder, "[demo]" in each task title. --remove deletes the workspace;
 * members, saved funders, tasks and history cascade.
 *
 * Runs as the migration role (MIGRATE_DATABASE_URL, else DATABASE_URL): the
 * app role cannot insert workspaces, by design. The owner must already have
 * signed in once (a row in getfunded.users), because members are keyed to
 * Supabase Auth ids; pass --owner <email> or set DEMO_OWNER_EMAIL.
 */
import postgres from "postgres";

const SLUG = "demo-food-bank";

function parseArgs(argv) {
  const opts = { remove: false, owner: process.env.DEMO_OWNER_EMAIL ?? null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--remove") opts.remove = true;
    else if (a === "--owner") opts.owner = argv[++i];
    else if (a.startsWith("--owner=")) opts.owner = a.slice(8);
    else {
      console.error(`seed-demo: unknown argument ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("seed-demo: set MIGRATE_DATABASE_URL (preferred) or DATABASE_URL");
  process.exit(2);
}
if (process.env.SELF_HOSTED !== "true") {
  console.error("seed-demo: refusing to run unless SELF_HOSTED=true (demo data never goes to the hosted service)");
  process.exit(2);
}

const sql = postgres(url, { max: 1, connect_timeout: 15, connection: { application_name: "getfunded-seed-demo" } });

const PROFILE = {
  mission:
    "A regional food bank that sources, stores and distributes food to partner pantries and meal programs, and runs nutrition education for families.",
  website: "https://example.org",
  state: "CA",
  counties: ["Example County"],
  program_areas: ["food security", "nutrition education", "emergency assistance"],
  annual_budget: 2400000,
  populations_served: ["families with children", "older adults", "people experiencing homelessness"],
  keywords: ["food bank", "hunger relief", "pantry network", "nutrition"],
};

async function remove() {
  const rows = await sql`delete from getfunded.workspaces where slug = ${SLUG} and settings ->> 'demo' = 'true' returning id`;
  console.log(rows.length ? `seed-demo: removed workspace ${SLUG} (${rows[0].id}) and everything under it` : `seed-demo: no demo workspace to remove`);
}

async function create() {
  if (!opts.owner) {
    console.error("seed-demo: pass --owner <email> (a user who has signed in once) or set DEMO_OWNER_EMAIL");
    process.exit(2);
  }
  const [owner] = await sql`select id from getfunded.users where email = ${opts.owner}`;
  if (!owner) {
    console.error(`seed-demo: no getfunded.users row for ${opts.owner}; sign in once first`);
    process.exit(1);
  }

  const [existing] = await sql`select id from getfunded.workspaces where slug = ${SLUG}`;
  if (existing) {
    console.log(`seed-demo: workspace ${SLUG} already exists (${existing.id}); run with --remove first to recreate`);
    return;
  }

  // Three well-known large foundations: the biggest private foundations by
  // reported assets that carry an EIN in the corpus. Chosen at run time so no
  // organisation name or EIN is hard-coded in the repo.
  const funders = await sql`
    select o.id, o.name, i.id_value as ein, o.org_type, o.city, o.state, o.website
    from public.organizations o
    join public.org_identifiers i on i.org_id = o.id and i.id_type = 'ein'
    where o.org_type = 'private_foundation'
      and o.asset_amount is not null
      and o.name is not null
    order by o.asset_amount desc nulls last, o.id
    limit 3`;
  if (funders.length < 3) {
    console.error(`seed-demo: expected three private foundations with EINs in the corpus, found ${funders.length}`);
    process.exit(1);
  }

  await sql.begin(async (tx) => {
    const [ws] = await tx`
      insert into getfunded.workspaces (slug, name, plan, profile, settings)
      values (${SLUG}, 'Demo Food Bank', 'free', ${sql.json(PROFILE)},
              ${sql.json({ demo: true, default_stage: "identified", timezone: "America/Los_Angeles" })})
      returning id`;
    await tx`insert into getfunded.members (workspace_id, user_id, role) values (${ws.id}, ${owner.id}, 'owner')`;

    const stages = ["identified", "researching", "qualified"];
    const savedIds = [];
    for (const [i, f] of funders.entries()) {
      const snapshot = { name: f.name, ein: f.ein, org_type: f.org_type, city: f.city, state: f.state, website: f.website };
      const [row] = await tx`
        insert into getfunded.saved_funders
          (workspace_id, org_id, snapshot, stage, tier, owner_id, source_detail, tags, created_by)
        values
          (${ws.id}, ${f.id}, ${sql.json(snapshot)}, ${stages[i]}, ${i + 1}, ${owner.id},
           'Demo seed: one of the three largest private foundations in the corpus', ${["demo"]}, ${owner.id})
        returning id`;
      savedIds.push(row.id);
      await tx`
        insert into getfunded.stage_history (saved_funder_id, workspace_id, from_stage, to_stage, changed_by, note)
        values (${row.id}, ${ws.id}, null, ${stages[i]}, ${owner.id}, 'demo seed')`;
      await tx`
        insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
        values (${ws.id}, ${row.id}, 'system', 'Added by the demo seed', ${owner.id}, '{"event":"demo_seed"}')`;
    }

    await tx`
      insert into getfunded.tasks (workspace_id, saved_funder_id, title, details, due_date, assignee_id, created_by)
      values
        (${ws.id}, ${savedIds[0]}, '[demo] Review the latest 990-PF and note the application window',
         'Open the funder profile, read Part XV, and record the deadline in next_action_due.',
         current_date + 7, ${owner.id}, ${owner.id}),
        (${ws.id}, ${savedIds[1]}, '[demo] Draft a two-paragraph introduction letter',
         'Use the outreach drafter; keep every claim tied to an approved knowledge fact.',
         current_date + 14, ${owner.id}, ${owner.id})`;

    console.log(`seed-demo: created workspace ${SLUG} (${ws.id}) owned by ${opts.owner}`);
    for (const f of funders) console.log(`  saved funder: ${f.name} (EIN ${f.ein})`);
    console.log("  tasks: 2");
  });
}

try {
  if (opts.remove) await remove();
  else await create();
} catch (err) {
  console.error(`seed-demo: FAILED: ${err?.message ?? err}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

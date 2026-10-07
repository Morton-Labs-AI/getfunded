import postgres from "postgres";

/**
 * The boundary proof. `npm run db:ping`.
 *
 * Two pools, two different guarantees, one command:
 *
 *   funder_ro (DATABASE_URL) ....... the ANALYST pool. Runs model-generated
 *                                    SQL (lib/ai/tools.ts). Must be read-only
 *                                    AND must be unable to name any community
 *                                    table — otherwise `select email from
 *                                    community.members` is one model turn away.
 *
 *   community_app (COMMUNITY_DATABASE_URL) ... the APPLICATION pool. Reads the
 *                                    corpus, writes the membership layer, and
 *                                    must NEVER be able to write internal.*.
 *
 * Every MUST-fail that succeeds exits 1. Wording matches
 * dnw-funder-intelligence/scripts/db-ping.mjs so failures in the two repos
 * read alike.
 */

let failed = false;

function pass(label, detail = "") {
  console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label, shout) {
  console.error(`  FAIL  ${label}`);
  console.error(`        ${shout}`);
  failed = true;
}

/** Assert a statement is refused. A statement that SUCCEEDS is the failure. */
async function mustFail(sql, label, shout, stmt) {
  try {
    await sql.unsafe(stmt);
    fail(label, shout);
  } catch (e) {
    pass(label, e.message.split("\n")[0].slice(0, 58));
  }
}

/** Assert a statement is permitted. */
async function mustWork(sql, label, stmt) {
  try {
    await sql.unsafe(stmt);
    pass(label);
  } catch (e) {
    fail(label, `expected to succeed, got: ${e.message.split("\n")[0]}`);
  }
}

// ---------------------------------------------------------------------------
// 1. The analyst pool.
// ---------------------------------------------------------------------------
console.log("\nanalyst pool (funder_ro)");

const ro = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  connection: {
    application_name: "ofdb-ping",
    default_transaction_read_only: "on",
    statement_timeout: "10000",
  },
});

const t0 = performance.now();
const [totals] = await ro`select * from internal.mv_overview_totals`;
pass(
  "corpus read",
  `${Math.round(performance.now() - t0)}ms — orgs=${totals.orgs} events=${totals.events}`
);

await mustFail(
  ro,
  "corpus write refused",
  "WRITE SUCCEEDED — read-only enforcement is BROKEN",
  "create table _write_probe (id int)"
);

// The analyst boundary. These are the probes that keep member PII out of a
// chat pane: lib/ai/sql-guard.ts allows any `select` with no schema
// restriction, so the ONLY thing standing between a model turn and an email
// address is funder_ro having no privileges in the community schema.
for (const [tbl, why] of [
  ["community.members", "the analyst boundary is BROKEN"],
  ["community.member_private", "MEMBER EMAIL IS REACHABLE FROM THE CHAT BOX"],
  ["community.invites", "the invite list is reachable from the chat box"],
  ["community.collections", "members' saved lists are reachable from the chat box"],
  ["community.notes", "members' private notes are reachable from the chat box"],
  ["community.follows", "the follow graph is reachable from the chat box"],
]) {
  await mustFail(
    ro,
    `analyst cannot read ${tbl}`,
    `ANALYST POOL CAN READ ${tbl.toUpperCase()} — ${why}`,
    `select 1 from ${tbl} limit 1`
  );
}

await ro.end();

// ---------------------------------------------------------------------------
// 2. The application pool.
// ---------------------------------------------------------------------------
if (!process.env.COMMUNITY_DATABASE_URL) {
  console.log("\napplication pool (community_app)");
  console.log("  skip  COMMUNITY_DATABASE_URL not set — community layer is off");
  console.log(
    failed ? "\ndb:ping FAILED\n" : "\ndb:ping ok (community probes skipped)\n"
  );
  process.exit(failed ? 1 : 0);
}

console.log("\napplication pool (community_app)");

const app = postgres(process.env.COMMUNITY_DATABASE_URL, {
  max: 1,
  connect_timeout: 10,
  connection: { application_name: "ofdb-ping-community", statement_timeout: "10000" },
});

const [{ whoami }] = await app`select current_user as whoami`;
if (whoami === "postgres" || whoami.startsWith("postgres.")) {
  fail(
    "community pool is not a superuser",
    `COMMUNITY_DATABASE_URL connects as "${whoami}" — a superuser BYPASSES every ` +
      `grant below, so the rest of this proof would be meaningless. Use community_app.`
  );
} else {
  pass("community pool identity", whoami);
}

await mustWork(app, "corpus read", "select count(*) from internal.organizations");

// THE one-way-flow assertion. Everything else in this design rests on it.
await mustFail(
  app,
  "corpus write refused",
  "CORPUS WRITE SUCCEEDED — one-way flow is BROKEN",
  "insert into internal.er_labels (job, label) values ('probe', 'match')"
);

// Column withholdings. A column-level REVOKE against a table-level GRANT is a
// no-op, so these two probes are the only thing that proves the
// revoke-then-column-grant sequence in community_0001 actually took.
await mustWork(
  app,
  "reads permitted org_web_facts columns",
  "select id, website_url from internal.org_web_facts limit 1"
);
await mustFail(
  app,
  "blind to org_web_facts.raw_source",
  "PUBLISHER PROSE IS READABLE — the publisher_website license gate is BROKEN",
  "select raw_source from internal.org_web_facts limit 1"
);
await mustFail(
  app,
  "blind to raw_files.storage_path",
  "RAW FILE PATHS ARE READABLE — the X15 withholding is BROKEN",
  "select storage_path from internal.raw_files limit 1"
);

// Membership-layer guarantees.
await mustFail(
  app,
  "cannot read the invite list",
  "THE INVITE LIST IS READABLE — community_app must go through may_sign_up()",
  "select 1 from community.invites limit 1"
);
await mustFail(
  app,
  "blind to member_private.signup_ip_hash",
  "SIGNUP IP HASHES ARE READABLE — the column-list grant is BROKEN",
  "select signup_ip_hash from community.member_private limit 1"
);
await mustFail(
  app,
  "cannot self-promote trust_tier",
  "SELF-PROMOTION SUCCEEDED — the trust ladder is BROKEN",
  "update community.members set trust_tier = 3"
);
await mustFail(
  app,
  "cannot self-activate",
  "SELF-ACTIVATION SUCCEEDED — a suspended member could restore themselves",
  "update community.members set status = 'active'"
);
await mustWork(app, "may_sign_up() is callable", "select community.may_sign_up('probe@example.com')");

// RLS fail-closed: with NO member context, member-owned tables must be empty.
// This is the standing proof that forgetting set_config() yields nothing rather
// than someone else's data.
for (const tbl of ["community.collections", "community.notes", "community.follows"]) {
  try {
    const [r] = await app.unsafe(`select count(*)::int as n from ${tbl}`);
    if (r.n === 0) pass(`RLS fail-closed on ${tbl}`, "0 rows with no member context");
    else fail(`RLS fail-closed on ${tbl}`,
      `RETURNED ${r.n} ROWS WITH NO MEMBER CONTEXT — RLS is not binding community_app`);
  } catch (e) {
    fail(`RLS fail-closed on ${tbl}`, e.message.split("\n")[0]);
  }
}

// The definer boundary: org_stats must still count rows RLS hides, or every
// follower/notes counter on an org page silently reads zero.
await mustWork(
  app,
  "org_stats() callable (aggregates survive RLS)",
  "select followers_n from community.org_stats(array[]::uuid[]) limit 1"
);

// A real write, rolled back — with member context, as the app always runs.
try {
  await app.begin(async (tx) => {
    const [m] = await tx`
      insert into community.members (auth_user_id) values (gen_random_uuid()) returning id`;
    await tx`select set_config('app.member_id', ${m.id}, true)`;
    await tx`update community.members set bio = 'db:ping' where id = ${m.id}`;
    throw new Error("__rollback__");
  });
  fail("community write + rollback", "the rollback sentinel did not propagate");
} catch (e) {
  if (e.message === "__rollback__") pass("community write works (rolled back)");
  else fail("community write + rollback", e.message.split("\n")[0]);
}

await app.end();

console.log(failed ? "\ndb:ping FAILED\n" : "\ndb:ping ok\n");
process.exit(failed ? 1 : 0);

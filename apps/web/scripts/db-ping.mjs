#!/usr/bin/env node
/**
 * Connectivity and boundary proof for the app connection (DATABASE_URL, the
 * getfunded_login role):
 *
 *   1. who am I, which server, which statement_timeout
 *   2. corpus READ works (public view and internal table)
 *   3. corpus WRITE must fail (no write grant on internal.*)
 *   4. getfunded WRITE under set_config works, and the append-only table
 *      refuses the DELETE (both inside a rolled-back transaction)
 *
 * Prints PASS or FAIL and exits 0 / 1.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db-ping: DATABASE_URL is not set");
  process.exit(2);
}

const sql = postgres(url, {
  max: 1,
  connect_timeout: 10,
  connection: { application_name: "getfunded-ping" },
});

const results = [];
const check = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? ` — ${note}` : ""}`);
};

const ROLLBACK = Symbol("rollback");

try {
  const t0 = performance.now();
  const [me] = await sql`
    select current_user,
           version() as version,
           current_setting('statement_timeout', true) as statement_timeout,
           pg_has_role(current_user, 'getfunded_app', 'member') as in_app_role`;
  console.log(`role: ${me.current_user}  (member of getfunded_app: ${me.in_app_role})`);
  console.log(`server: ${me.version.split(" on ")[0]}`);
  console.log(`statement_timeout: ${me.statement_timeout}`);
  check("connected", true, `${Math.round(performance.now() - t0)} ms`);
  check("role inherits getfunded_app", me.in_app_role === true);

  // 2. corpus read
  try {
    const [{ n }] = await sql`select count(*)::int as n from (select 1 from public.organizations limit 1) t`;
    check("corpus read: public.organizations", n === 1);
  } catch (e) {
    check("corpus read: public.organizations", false, e.message);
  }
  try {
    const [{ n }] = await sql`select count(*)::int as n from (select 1 from internal.organizations limit 1) t`;
    check("corpus read: internal.organizations", n === 1);
  } catch (e) {
    check("corpus read: internal.organizations", false, e.message);
  }

  // 3. corpus write MUST fail. Inside a transaction we always roll back, so
  // even an unexpected success leaves no trace.
  let corpusWriteBlocked = false;
  let corpusWriteNote = "";
  await sql
    .begin(async (tx) => {
      try {
        await tx`insert into internal.org_web_facts default values`;
        corpusWriteNote = "INSERT SUCCEEDED — corpus is writable by the app role";
      } catch (e) {
        corpusWriteBlocked = /permission denied/i.test(e.message);
        corpusWriteNote = e.message.slice(0, 80);
      }
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  check("corpus write refused (internal.org_web_facts)", corpusWriteBlocked, corpusWriteNote);

  // 4. getfunded write under set_config, append-only delete refused, rolled back.
  let insertOk = false;
  let deleteRefused = false;
  let note = "";
  await sql
    .begin(async (tx) => {
      const [{ uid }] = await tx`select gen_random_uuid()::text as uid`;
      await tx`select set_config('app.user_id', ${uid}, true)`;
      try {
        const [row] = await tx`
          insert into getfunded.events (user_id, name, props)
          values (${uid}::uuid, 'db_ping', '{"source":"scripts/db-ping.mjs"}')
          returning id`;
        insertOk = row?.id != null;
      } catch (e) {
        note = e.message.slice(0, 80);
      }
      if (insertOk) {
        try {
          await tx`delete from getfunded.events where name = 'db_ping'`;
          note = "DELETE SUCCEEDED — events is not append-only";
        } catch (e) {
          deleteRefused = /permission denied/i.test(e.message);
          if (!deleteRefused) note = e.message.slice(0, 80);
        }
      }
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  check("getfunded write under set_config (events insert, rolled back)", insertOk, insertOk ? "" : note);
  check("append-only: events delete refused", deleteRefused, deleteRefused ? "" : note);

  // Fail-closed probe: no app.user_id means no rows.
  const [{ n }] = await sql`select count(*)::int as n from getfunded.workspaces`;
  check("fail closed: workspaces without app.user_id", n === 0, n === 0 ? "" : `${n} rows visible`);
} catch (err) {
  check("unexpected error", false, err?.message ?? String(err));
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL (${failed.length} of ${results.length} checks failed)` : `\nPASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);

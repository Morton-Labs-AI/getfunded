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
 *   5. the provenance-hash column grant from migration 0010 is in place
 *
 * And, when ANALYST_DATABASE_URL is set, the same for the analyst connection
 * (role funder_ro, "Ask the analyst"):
 *
 *   6. the relations funder_ro can SELECT in schemas internal and public are
 *      EXACTLY the allowlist in lib/ai/sql-guard.ts (ALLOWED_PUBLIC_VIEWS and
 *      ALLOWED_MATVIEWS), read from that file so the two cannot drift apart
 *   7. no access to schema getfunded, transactions read-only by default,
 *      a write refused
 *
 * Prints PASS or FAIL and exits 0 / 1.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db-ping: DATABASE_URL is not set");
  process.exit(2);
}

const results = [];
const check = (name, ok, note = "") => {
  results.push({ name, ok, note });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? ` — ${note}` : ""}`);
};

const ROLLBACK = Symbol("rollback");

/**
 * The guard's allowlist, read from its source so this script and the guard
 * can never disagree. Returns { publicViews, matviews } or throws.
 */
export function readGuardAllowlist(file = fileURLToPath(new URL("../lib/ai/sql-guard.ts", import.meta.url))) {
  const text = readFileSync(file, "utf8");
  const pick = (name) => {
    const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(text);
    if (!m) throw new Error(`db-ping: could not find ${name} in lib/ai/sql-guard.ts`);
    const names = [...m[1].matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((x) => x[1]);
    if (names.length === 0) throw new Error(`db-ping: ${name} in lib/ai/sql-guard.ts is empty`);
    return names;
  };
  return { publicViews: pick("ALLOWED_PUBLIC_VIEWS"), matviews: pick("ALLOWED_MATVIEWS") };
}

async function appChecks() {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    connection: { application_name: "getfunded-ping" },
  });
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
          // No RETURNING: RLS applies the SELECT policy to returned rows, and a
          // non-steward user with no workspace cannot read the row it just wrote.
          const res = await tx`
            insert into getfunded.events (user_id, name, props)
            values (${uid}::uuid, 'db_ping', '{"source":"scripts/db-ping.mjs"}')`;
          insertOk = res.count === 1;
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

    // 5. provenance hash column grant (migration 0010): id and sha256 only.
    try {
      const [p] = await sql`
        select to_regclass('internal.raw_files') is not null as present,
               case when to_regclass('internal.raw_files') is null then null
                    else has_column_privilege('internal.raw_files', 'sha256', 'select')
                         and has_column_privilege('internal.raw_files', 'id', 'select') end as hash_ok,
               case when to_regclass('internal.raw_files') is null then null
                    else has_column_privilege('internal.raw_files', 'source_url', 'select')
                         or has_table_privilege('internal.raw_files', 'select') end as too_much`;
      if (!p.present) {
        check("provenance hash grant (internal.raw_files id, sha256)", true, "no corpus on this database; skipped");
      } else {
        check("provenance hash grant (internal.raw_files id, sha256)", p.hash_ok === true, p.hash_ok ? "" : "apply migration getfunded_0010");
        check("raw_files: nothing beyond id and sha256", p.too_much === false, p.too_much ? "the app role can read more of raw_files than it should" : "");
      }
    } catch (e) {
      check("provenance hash grant (internal.raw_files id, sha256)", false, e.message.slice(0, 120));
    }
  } catch (err) {
    check("unexpected error", false, err?.message ?? String(err));
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function analystChecks(analystUrl) {
  let allow;
  try {
    allow = readGuardAllowlist();
  } catch (e) {
    check("analyst: read the guard allowlist from lib/ai/sql-guard.ts", false, e.message);
    return;
  }
  const expected = new Set([...allow.publicViews.map((v) => `public.${v}`), ...allow.matviews.map((v) => `internal.${v}`)]);

  const sql = postgres(analystUrl, {
    max: 1,
    connect_timeout: 10,
    connection: { application_name: "getfunded-ping-analyst" },
  });
  try {
    const [me] = await sql`
      select current_user,
             current_setting('default_transaction_read_only', true) as read_only,
             current_setting('statement_timeout', true) as statement_timeout,
             current_setting('search_path', true) as search_path,
             has_schema_privilege('getfunded', 'usage') as getfunded_usage`;
    console.log(`analyst role: ${me.current_user}  read_only=${me.read_only}  statement_timeout=${me.statement_timeout}  search_path=${me.search_path}`);
    check("analyst: connected", true);
    check("analyst: transactions read-only by default", me.read_only === "on", me.read_only === "on" ? "" : `default_transaction_read_only=${me.read_only}`);
    check("analyst: no access to schema getfunded", me.getfunded_usage === false, me.getfunded_usage ? "funder_ro has USAGE on getfunded" : "");

    // 6. Readable relations in internal + public must equal the guard's allowlist.
    const rows = await sql`
      select n.nspname || '.' || c.relname as rel
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('internal', 'public', 'getfunded')
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_table_privilege(c.oid, 'select')
      order by 1`;
    const readable = new Set(rows.map((r) => r.rel));
    const extra = [...readable].filter((r) => !expected.has(r));
    const missing = [...expected].filter((r) => !readable.has(r));
    const ok = extra.length === 0 && missing.length === 0;
    const notes = [];
    if (extra.length) notes.push(`can read but should not: ${extra.join(", ")}`);
    if (missing.length) notes.push(`should read but cannot: ${missing.join(", ")}`);
    check(`analyst: readable relations equal the guard allowlist (${expected.size})`, ok, ok ? `${readable.size} relations` : `${notes.join("; ")} — apply migration getfunded_0010`);

    // 7. A write is refused even inside an explicit transaction.
    let writeRefused = false;
    let writeNote = "";
    await sql
      .begin(async (tx) => {
        try {
          await tx`create temporary table gf_ping_probe (x int)`;
          writeNote = "CREATE TEMP TABLE SUCCEEDED — the analyst connection is not read-only";
        } catch (e) {
          writeRefused = /read-only|permission denied/i.test(e.message);
          writeNote = e.message.slice(0, 80);
        }
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    check("analyst: write refused", writeRefused, writeNote);
  } catch (err) {
    check("analyst: unexpected error", false, err?.message ?? String(err));
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

await appChecks();
if (process.env.ANALYST_DATABASE_URL) {
  console.log("");
  await analystChecks(process.env.ANALYST_DATABASE_URL);
} else {
  console.log("\n(ANALYST_DATABASE_URL not set: analyst role checks skipped)");
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nFAIL (${failed.length} of ${results.length} checks failed)` : `\nPASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);

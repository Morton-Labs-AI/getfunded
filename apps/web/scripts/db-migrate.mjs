#!/usr/bin/env node
/**
 * Apply migrations/getfunded_*.sql in order.
 *
 *   node --env-file=.env.local scripts/db-migrate.mjs [--dry-run] [--force] [--to 0004] [--status]
 *
 * Connection: MIGRATE_DATABASE_URL if set, else DATABASE_URL. Migrations must
 * run as the object owner (postgres on Supabase, a superuser elsewhere), NOT
 * as getfunded_login; migration 0001 refuses a runner without BYPASSRLS.
 *
 * Ledger: getfunded.schema_migrations (filename, sha256, applied_at).
 *   - applied + same hash     -> skipped
 *   - applied + different hash -> refused, unless --force (re-applied, hash updated)
 *   - --dry-run                -> print the plan, change nothing
 *   - --to <prefix>            -> stop after the file whose name starts with it
 *     (a bare number like 4 or 0004 is accepted)
 *   - --status                 -> list applied and pending files
 *
 * Each file runs in its own transaction with the ledger row, under an advisory
 * lock so two runners cannot race.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const FILE_RE = /^getfunded_(\d{4})_.+\.sql$/;
const LOCK_KEY = 0x6766_6d69; // 'gfmi'

function parseArgs(argv) {
  const opts = { dryRun: false, force: false, to: null, status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--status") opts.status = true;
    else if (a === "--to") {
      opts.to = argv[++i];
      if (!opts.to) fail("--to needs a value (e.g. --to 0004)");
    } else if (a.startsWith("--to=")) opts.to = a.slice(5);
    else fail(`unknown argument ${a}`);
  }
  return opts;
}

function fail(message, code = 2) {
  console.error(`db-migrate: ${message}`);
  process.exit(code);
}

function normaliseTo(to) {
  if (to == null) return null;
  const digits = /^\d+$/.test(to) ? to.padStart(4, "0") : null;
  return digits ? `getfunded_${digits}` : to;
}

async function listMigrations() {
  const names = (await readdir(MIGRATIONS_DIR)).filter((f) => FILE_RE.test(f)).sort();
  const seen = new Set();
  for (const n of names) {
    const num = FILE_RE.exec(n)[1];
    if (seen.has(num)) fail(`two migrations share the number ${num}`);
    seen.add(num);
  }
  return Promise.all(
    names.map(async (filename) => {
      const text = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
      return { filename, text, sha256: createHash("sha256").update(text).digest("hex") };
    }),
  );
}

const opts = parseArgs(process.argv.slice(2));
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) fail("set MIGRATE_DATABASE_URL (preferred) or DATABASE_URL");

const sql = postgres(url, {
  max: 1,
  connect_timeout: 15,
  onnotice: (n) => {
    if (n.severity !== "DEBUG") console.log(`  notice: ${n.message}`);
  },
  connection: { application_name: "getfunded-migrate" },
});

try {
  const [{ current_user: runner, version }] = await sql`select current_user, version()`;
  console.log(`db-migrate: ${process.env.MIGRATE_DATABASE_URL ? "MIGRATE_DATABASE_URL" : "DATABASE_URL"} as ${runner}`);
  console.log(`db-migrate: ${version.split(" on ")[0]}`);

  await sql`select pg_advisory_lock(${LOCK_KEY})`;

  await sql`create schema if not exists getfunded`;
  await sql`create table if not exists getfunded.schema_migrations (
    filename   text        primary key,
    sha256     text        not null,
    applied_at timestamptz not null default now()
  )`;

  const files = await listMigrations();
  const applied = new Map(
    (await sql`select filename, sha256, applied_at from getfunded.schema_migrations`).map((r) => [r.filename, r]),
  );

  const toPrefix = normaliseTo(opts.to);
  if (toPrefix && !files.some((f) => f.filename.startsWith(toPrefix))) {
    fail(`--to ${opts.to}: no migration starts with ${toPrefix}`);
  }

  const plan = [];
  for (const f of files) {
    const row = applied.get(f.filename);
    let action;
    if (!row) action = "apply";
    else if (row.sha256 === f.sha256) action = "skip";
    else action = opts.force ? "reapply" : "changed";
    plan.push({ ...f, action, appliedAt: row?.applied_at ?? null });
    if (toPrefix && f.filename.startsWith(toPrefix)) break;
  }

  if (opts.status) {
    for (const p of plan) {
      const when = p.appliedAt ? p.appliedAt.toISOString() : "pending";
      console.log(`  ${p.action === "changed" ? "!" : p.appliedAt ? "✓" : "·"} ${p.filename}  ${when}${p.action === "changed" ? "  (hash differs)" : ""}`);
    }
    const unknown = [...applied.keys()].filter((k) => !files.some((f) => f.filename === k));
    for (const k of unknown) console.log(`  ? ${k}  applied, but no such file`);
    process.exit(0);
  }

  const changed = plan.filter((p) => p.action === "changed");
  if (changed.length) {
    for (const p of changed) console.error(`db-migrate: ${p.filename} was applied with a different hash`);
    fail("refusing to continue; re-run with --force to re-apply the changed files", 3);
  }

  const todo = plan.filter((p) => p.action !== "skip");
  if (!todo.length) {
    console.log("db-migrate: nothing to do");
    process.exit(0);
  }

  for (const p of todo) {
    const verb = p.action === "reapply" ? "re-apply" : "apply";
    if (opts.dryRun) {
      console.log(`  would ${verb} ${p.filename} (${p.sha256.slice(0, 12)})`);
      continue;
    }
    const t0 = performance.now();
    await sql.begin(async (tx) => {
      await tx.unsafe(p.text);
      await tx`insert into getfunded.schema_migrations (filename, sha256, applied_at)
               values (${p.filename}, ${p.sha256}, now())
               on conflict (filename) do update set sha256 = excluded.sha256, applied_at = now()`;
    });
    console.log(`  ${verb === "apply" ? "applied" : "re-applied"} ${p.filename} in ${Math.round(performance.now() - t0)} ms`);
  }
  console.log(opts.dryRun ? "db-migrate: dry run, nothing changed" : "db-migrate: done");
} catch (err) {
  console.error(`db-migrate: FAILED: ${err?.message ?? err}`);
  if (err?.detail) console.error(`  detail: ${err.detail}`);
  if (err?.hint) console.error(`  hint: ${err.hint}`);
  if (err?.position) console.error(`  position: ${err.position}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}

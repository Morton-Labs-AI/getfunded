// @vitest-environment node
/**
 * Replays migrations/getfunded_0008_billing_webhook.sql into PGlite (real
 * Postgres in WASM) over stub copies of the tables it touches, then drives
 * the two SECURITY DEFINER doors through every outcome. No network, no
 * Supabase. The stubs mirror the column shapes in docs/DATA-MODEL.md and
 * migrations 0002/0007; the full-chain replay lives with the schema tests.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = resolve(process.cwd(), "migrations/getfunded_0008_billing_webhook.sql");

const STUBS = `
create schema if not exists getfunded;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'getfunded_app') then
    create role getfunded_app nologin;
  end if;
end $$;
create table getfunded.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'ws',
  plan text not null default 'free' check (plan in ('free','starter','pro','team','enterprise','unlimited')),
  billing_anchor_day smallint not null default 1 check (billing_anchor_day between 1 and 31),
  stripe_customer_id text unique,
  deleted_at timestamptz,
  version int not null default 1
);
create table getfunded.subscriptions (
  workspace_id uuid primary key references getfunded.workspaces(id) on delete cascade,
  stripe_subscription_id text unique,
  plan text not null check (plan in ('free','starter','pro','team','enterprise','unlimited')),
  status text not null check (status in ('trialing','active','past_due','canceled','unpaid')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  version int not null default 1
);
create table getfunded.events (
  id bigserial primary key,
  workspace_id uuid,
  user_id uuid,
  name text not null,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table getfunded.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references getfunded.workspaces(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{read}',
  created_by uuid,
  last_used_at timestamptz,
  revoked_at timestamptz
);
`;

type Outcome = { outcome: string; workspace_id: string | null; plan: string | null };

let db: PGlite;

async function apply(args: {
  event?: string | null;
  ws?: string | null;
  customer?: string | null;
  sub?: string | null;
  plan?: string | null;
  status?: string | null;
  start?: string | null;
  end?: string | null;
  cancel?: boolean | null;
  raw?: unknown;
  props?: unknown;
}): Promise<Outcome> {
  const r = await db.query<Outcome>(
    `select * from getfunded.apply_subscription($1, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::boolean, $10::jsonb, $11::jsonb)`,
    [
      args.event ?? null,
      args.ws ?? null,
      args.customer ?? null,
      args.sub ?? null,
      args.plan ?? null,
      args.status ?? null,
      args.start ?? null,
      args.end ?? null,
      args.cancel ?? null,
      args.raw === undefined ? null : JSON.stringify(args.raw),
      JSON.stringify(args.props ?? {}),
    ],
  );
  return r.rows[0];
}

async function workspace(id: string) {
  const r = await db.query<{ plan: string; billing_anchor_day: number; stripe_customer_id: string | null; version: number }>(
    "select plan, billing_anchor_day, stripe_customer_id, version from getfunded.workspaces where id = $1",
    [id],
  );
  return r.rows[0];
}

async function subscription(ws: string) {
  const r = await db.query<{ stripe_subscription_id: string; plan: string; status: string; cancel_at_period_end: boolean; raw: unknown }>(
    "select stripe_subscription_id, plan, status, cancel_at_period_end, raw from getfunded.subscriptions where workspace_id = $1",
    [ws],
  );
  return r.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(readFileSync(MIGRATION, "utf8"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

describe("getfunded.apply_subscription", () => {
  let ws: string;

  it("applies a new active subscription: subscriptions upsert, plan, anchor day, customer id", async () => {
    ws = (await db.query<{ id: string }>("insert into getfunded.workspaces default values returning id")).rows[0].id;
    const out = await apply({ event: "stripe:evt_1", ws, customer: "cus_1", sub: "sub_1", plan: "pro", status: "active", start: "2026-01-15T00:00:00Z", end: "2026-02-15T00:00:00Z", cancel: false, raw: { id: "sub_1" }, props: { type: "customer.subscription.created" } });
    expect(out).toEqual({ outcome: "applied", workspace_id: ws, plan: "pro" });
    expect(await workspace(ws)).toMatchObject({ plan: "pro", billing_anchor_day: 15, stripe_customer_id: "cus_1", version: 2 });
    expect(await subscription(ws)).toMatchObject({ stripe_subscription_id: "sub_1", plan: "pro", status: "active", cancel_at_period_end: false, raw: { id: "sub_1" } });
    const ev = await db.query<{ workspace_id: string; props: unknown }>("select workspace_id, props from getfunded.events where name = 'stripe:evt_1'");
    expect(ev.rows[0]).toEqual({ workspace_id: ws, props: { type: "customer.subscription.created" } });
  });

  it("a redelivered event is a duplicate and changes nothing", async () => {
    const out = await apply({ event: "stripe:evt_1", ws, customer: "cus_1", sub: "sub_1", plan: "team", status: "active" });
    expect(out.outcome).toBe("duplicate");
    expect((await workspace(ws)).plan).toBe("pro");
    expect((await db.query("select count(*)::int as n from getfunded.events where name like 'stripe:%'")).rows[0]).toEqual({ n: 1 });
  });

  it("finds the workspace by customer id, keeps the plan on past_due with null plan/periods", async () => {
    const out = await apply({ event: "stripe:evt_2", customer: "cus_1", sub: "sub_1", status: "past_due" });
    expect(out).toEqual({ outcome: "applied", workspace_id: ws, plan: "pro" });
    expect(await subscription(ws)).toMatchObject({ plan: "pro", status: "past_due", raw: { id: "sub_1" } });
    expect((await workspace(ws)).billing_anchor_day).toBe(15);
  });

  it("finds the workspace by subscription id when customer and workspace are unknown", async () => {
    const out = await apply({ event: "stripe:evt_3", sub: "sub_1", plan: "team", status: "active", cancel: true });
    expect(out).toEqual({ outcome: "applied", workspace_id: ws, plan: "team" });
    expect(await subscription(ws)).toMatchObject({ plan: "team", status: "active", cancel_at_period_end: true });
    expect((await workspace(ws)).plan).toBe("team");
  });

  it("a terminal event for an older subscription id is stale and ignored", async () => {
    const out = await apply({ event: "stripe:evt_4", ws, sub: "sub_old", plan: null, status: "canceled" });
    expect(out).toEqual({ outcome: "stale", workspace_id: ws, plan: "team" });
    expect(await subscription(ws)).toMatchObject({ stripe_subscription_id: "sub_1", status: "active" });
    expect((await workspace(ws)).plan).toBe("team");
  });

  it("deleting the current subscription drops the workspace to free and resets the anchor", async () => {
    const out = await apply({ event: "stripe:evt_5", ws, customer: "cus_1", sub: "sub_1", plan: "team", status: "canceled" });
    expect(out).toEqual({ outcome: "applied", workspace_id: ws, plan: "free" });
    expect(await workspace(ws)).toMatchObject({ plan: "free", billing_anchor_day: 1 });
    expect(await subscription(ws)).toMatchObject({ status: "canceled", plan: "team" });
  });

  it("a re-subscription with a new id replaces the row and restores the plan", async () => {
    const out = await apply({ event: "stripe:evt_6", ws, customer: "cus_1", sub: "sub_2", plan: "starter", status: "trialing", start: "2026-03-03T00:00:00Z", end: "2026-04-03T00:00:00Z" });
    expect(out.plan).toBe("starter");
    expect(await subscription(ws)).toMatchObject({ stripe_subscription_id: "sub_2", status: "trialing", plan: "starter" });
    expect(await workspace(ws)).toMatchObject({ plan: "starter", billing_anchor_day: 3 });
  });

  it("unknown workspace: reported, recorded, and idempotent", async () => {
    const out = await apply({ event: "stripe:evt_7", customer: "cus_nobody", sub: "sub_x", plan: "pro", status: "active" });
    expect(out).toEqual({ outcome: "unknown_workspace", workspace_id: null, plan: null });
    expect((await apply({ event: "stripe:evt_7", customer: "cus_nobody", sub: "sub_x", plan: "pro", status: "active" })).outcome).toBe("duplicate");
  });

  it("without an event name the idempotency check is skipped", async () => {
    const out = await apply({ ws, customer: "cus_1", sub: "sub_2", status: "active" });
    expect(out.outcome).toBe("applied");
    expect((await subscription(ws)).status).toBe("active");
  });

  it("rejects values outside the vocabularies", async () => {
    await expect(apply({ event: "stripe:evt_8", ws, sub: "sub_2", status: "paused" })).rejects.toThrow(/invalid status/);
    await expect(apply({ event: "stripe:evt_9", ws, sub: "sub_2", plan: "gold", status: "active" })).rejects.toThrow(/invalid plan/);
  });

  it("is executable by getfunded_app only (owner-rights door)", async () => {
    const r = await db.query<{ app: boolean; pub: boolean }>(
      `select has_function_privilege('getfunded_app', 'getfunded.apply_subscription(text, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, jsonb)', 'execute') as app,
              has_function_privilege('getfunded_app', 'getfunded.verify_api_key(text)', 'execute') as pub`,
    );
    expect(r.rows[0]).toEqual({ app: true, pub: true });
    const sd = await db.query<{ n: string }>("select proname as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'getfunded' and p.prosecdef order by 1");
    expect(sd.rows.map((x) => x.n)).toEqual(["apply_subscription", "verify_api_key"]);
  });
});

describe("getfunded.verify_api_key", () => {
  const plaintext = "gf_live_" + "A".repeat(32);
  const hash = createHash("sha256").update(plaintext).digest("hex");
  let ws: string;
  let keyId: string;

  beforeAll(async () => {
    ws = (await db.query<{ id: string }>("insert into getfunded.workspaces (plan) values ('team') returning id")).rows[0].id;
    keyId = (
      await db.query<{ id: string }>(
        "insert into getfunded.api_keys (workspace_id, name, key_prefix, key_hash, scopes, created_by) values ($1, 'CI', $2, $3, '{read,write}', '22222222-2222-4222-8222-222222222222') returning id",
        [ws, plaintext.slice(0, 16), hash],
      )
    ).rows[0].id;
  });

  it("returns the key, workspace, scopes, creator and plan for a valid hash, and touches last_used_at", async () => {
    const r = await db.query<{ id: string; workspace_id: string; name: string; scopes: string[]; created_by: string; plan: string }>("select * from getfunded.verify_api_key($1)", [hash]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({ id: keyId, workspace_id: ws, name: "CI", scopes: ["read", "write"], created_by: "22222222-2222-4222-8222-222222222222", plan: "team" });
    const touched = await db.query<{ t: string | null }>("select last_used_at as t from getfunded.api_keys where id = $1", [keyId]);
    expect(touched.rows[0].t).not.toBeNull();
  });

  it("returns nothing for unknown, malformed, revoked keys or deleted workspaces", async () => {
    expect((await db.query("select * from getfunded.verify_api_key($1)", ["f".repeat(64)])).rows).toHaveLength(0);
    expect((await db.query("select * from getfunded.verify_api_key($1)", ["short"])).rows).toHaveLength(0);
    expect((await db.query("select * from getfunded.verify_api_key(null)")).rows).toHaveLength(0);
    await db.query("update getfunded.api_keys set revoked_at = now() where id = $1", [keyId]);
    expect((await db.query("select * from getfunded.verify_api_key($1)", [hash])).rows).toHaveLength(0);
    await db.query("update getfunded.api_keys set revoked_at = null where id = $1", [keyId]);
    await db.query("update getfunded.workspaces set deleted_at = now() where id = $1", [ws]);
    expect((await db.query("select * from getfunded.verify_api_key($1)", [hash])).rows).toHaveLength(0);
  });
});

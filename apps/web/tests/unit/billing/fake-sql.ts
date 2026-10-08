/**
 * A fake postgres.js tagged-template function that records every call and
 * answers from a handler. `text` renders the template with `$1`, `$2`...
 * placeholders and collapsed whitespace, so assertions can `includes()` the
 * function or table being touched.
 */
import type postgres from "postgres";

export type SqlCall = { text: string; values: unknown[] };
export type SqlHandler = (call: SqlCall, index: number) => unknown[] | undefined | Promise<unknown[] | undefined>;

export type FakeSql = {
  sql: postgres.Sql;
  tx: postgres.TransactionSql;
  calls: SqlCall[];
  texts: () => string[];
  /** The calls whose text contains `needle`. */
  find: (needle: string) => SqlCall[];
};

export function renderTemplate(strings: TemplateStringsArray, values: unknown[]): string {
  let out = "";
  strings.raw.forEach((s, i) => {
    out += s;
    if (i < values.length) out += `$${i + 1}`;
  });
  return out.replace(/\s+/g, " ").trim();
}

export function makeFakeSql(handler: SqlHandler = () => []): FakeSql {
  const calls: SqlCall[] = [];
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { text: renderTemplate(strings, values), values };
    calls.push(call);
    return Promise.resolve(handler(call, calls.length - 1)).then((rows) => rows ?? []);
  };
  fn.json = (value: unknown) => ({ __json: value });
  fn.begin = async (arg: unknown, maybe?: unknown) => {
    const cb = (typeof arg === "function" ? arg : maybe) as (s: unknown) => unknown;
    return cb(fn);
  };
  fn.unsafe = async () => [];
  const sql = fn as unknown as postgres.Sql;
  return {
    sql,
    tx: fn as unknown as postgres.TransactionSql,
    calls,
    texts: () => calls.map((c) => c.text),
    find: (needle) => calls.filter((c) => c.text.includes(needle)),
  };
}

/** A `withUser` double that records user ids and hands `fn` the fake transaction. */
export function makeFakeWithUser(fake: FakeSql) {
  const users: (string | null)[] = [];
  const withUser = async <T>(userId: string | null, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    users.push(userId);
    return fn(fake.tx);
  };
  return { withUser, users };
}

/** Unwrap a `sql.json()` marker recorded by the fake. */
export function jsonValue(v: unknown): unknown {
  return v && typeof v === "object" && "__json" in v ? (v as { __json: unknown }).__json : v;
}

export const WS = "11111111-1111-4111-8111-111111111111";
export const USER = "22222222-2222-4222-8222-222222222222";
export const OTHER_USER = "33333333-3333-4333-8333-333333333333";

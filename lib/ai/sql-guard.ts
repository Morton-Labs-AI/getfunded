/**
 * Pure SQL-guard logic (no imports — unit-testable under plain Node).
 *
 * Four deterministic layers protect model-generated SQL — none prompt-dependent:
 *   1. statement-head allowlist (select | with | explain)        ← here
 *   2. single statement (no embedded semicolons)                 ← here
 *   3. read-only enforcement: the funder_ro role has SELECT-only grants and
 *      role-level default_transaction_read_only=on (survives the pooler);
 *      queries additionally run inside an explicit READ ONLY transaction,
 *      which kills data-modifying CTEs at execution.
 *   4. LIMIT wrap (500) + role-level statement_timeout (15s).
 * No regex keyword blocklist: this database is *about* grants — a blocklist
 * false-positives on event_type = 'grant'.
 */
export class GuardError extends Error {}

export const ROW_CAP = 500;

export function guardSql(raw: string): string {
  const q = raw.trim().replace(/;+\s*$/, "");
  if (q.includes(";")) {
    throw new GuardError("Multiple statements are not allowed.");
  }
  if (!/^\s*(select|with|explain)\b/i.test(q)) {
    throw new GuardError("Only SELECT / WITH / EXPLAIN queries are allowed.");
  }
  return q;
}

export interface GuardedResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  ms: number;
  capped: boolean;
}

export function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

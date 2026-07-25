import { sql } from "@/lib/db";

/**
 * Four deterministic layers for model-generated SQL — none prompt-dependent:
 *   1. statement-head allowlist (select | with | explain)
 *   2. single statement (no embedded semicolons)
 *   3. read-only enforcement: the funder_ro role has SELECT-only grants and
 *      role-level default_transaction_read_only=on (survives the pooler);
 *      queries additionally run inside an explicit READ ONLY transaction,
 *      which kills data-modifying CTEs at execution.
 *   4. LIMIT wrap (500) + role-level statement_timeout (15s).
 * No regex keyword blocklist: this database is *about* grants — a blocklist
 * false-positives on event_type = 'grant'.
 */
export class GuardError extends Error {}

const ROW_CAP = 500;

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

function serialize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

export async function runGuardedQuery(raw: string): Promise<GuardedResult> {
  const q = guardSql(raw);
  const isExplain = /^\s*explain\b/i.test(q);
  const wrapped = isExplain ? q : `select * from (\n${q}\n) _q limit ${ROW_CAP}`;

  const t0 = performance.now();
  const result = await sql.begin("read only", (tx) => tx.unsafe(wrapped));
  const ms = Math.round(performance.now() - t0);

  const rowsIn = result as unknown as Record<string, unknown>[];
  const columns =
    (result as unknown as { columns?: { name: string }[] }).columns?.map(
      (c) => c.name
    ) ?? Object.keys(rowsIn[0] ?? {});

  // Contact-channel privacy mask: raw contact values never leave the server,
  // regardless of what the model selected.
  const maskContacts = /contact_channels/i.test(q);
  const valueIdx = columns.indexOf("value");

  const rows = rowsIn.map((r) =>
    columns.map((c, i) =>
      maskContacts && i === valueIdx && r[c] != null
        ? "•• on file (internal) ••"
        : serialize(r[c])
    )
  );

  return {
    columns,
    rows,
    rowCount: rows.length,
    ms,
    capped: !isExplain && rows.length === ROW_CAP,
  };
}

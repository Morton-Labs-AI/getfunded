/**
 * Pure SQL guard for model-written queries (no imports; unit-tested).
 *
 * Deterministic layers protect "Ask the analyst"; none depends on the prompt:
 *   1. statement head allowlist: select | with | explain            ← here
 *   2. one statement: no semicolons after comment stripping          ← here
 *   3. relation allowlist: public.* views and internal.mv_* only;
 *      pg_catalog / information_schema / every other schema refused  ← here
 *   4. function denylist for the few builtins that could stall or
 *      change settings (pg_sleep, set_config, ...)                   ← here
 *   5. DML keywords refused outside string literals (a CTE cannot
 *      smuggle an INSERT)                                            ← here
 *   6. the `funder_ro` role is read-only at the role level, runs in an
 *      explicit READ ONLY transaction with search_path = public and a
 *      15 s statement timeout                                        ← lib/ai/ask.ts
 *   7. LIMIT wrap at 500 rows                                        ← wrapWithLimit()
 *
 * Over-strict by design: a rejected query costs one model retry; a leaked
 * row cannot be taken back.
 */
export class GuardError extends Error {
  readonly code = "sql_rejected" as const;
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export const ROW_CAP = 500;

/** The public views the app may read (all 14) and the matviews the analyst may read. */
export const ALLOWED_PUBLIC_VIEWS = [
  "organizations",
  "funding_events",
  "contact_channels",
  "org_application_posture",
  "org_financial_series",
  "filings",
  "filing_financials",
  "filing_application_info",
  "filing_contributors",
  "filing_officers",
  "funding_programs",
  "org_identifiers",
  "people",
  "relationships",
] as const;

export const ALLOWED_MATVIEWS = [
  "mv_org_latest_financials",
  "mv_org_application_posture",
  "mv_funder_event_stats",
  "mv_recipient_event_stats",
  "mv_overview_totals",
  "mv_org_type_counts",
  "mv_org_state_counts",
  "mv_event_type_totals",
  "mv_events_by_year",
  "mv_top_funders",
  "mv_amount_histogram",
] as const;

const PUBLIC = new Set<string>(ALLOWED_PUBLIC_VIEWS);
const MATVIEWS = new Set<string>(ALLOWED_MATVIEWS);

/** Allowed callable functions in schema internal. */
const INTERNAL_FUNCTIONS = new Set(["similar_orgs", "hybrid_search"]);

const DENIED_FUNCTIONS =
  /\b(pg_sleep|pg_sleep_for|pg_sleep_until|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|dblink|dblink_exec|lo_import|lo_export|lo_get|pg_terminate_backend|pg_cancel_backend|set_config|pg_notify|pg_reload_conf|pg_advisory_lock|pg_advisory_xact_lock|current_setting)\s*\(/i;

const DML_KEYWORDS = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|analyze|analyse|refresh|reindex|cluster|lock|listen|notify|unlisten|discard|reset|begin|commit|rollback|savepoint|prepare|execute|deallocate|do|call|merge|import|security|comment)\b/i;

/** Replace string literals, quoted identifiers and comments with placeholders so scanning cannot be fooled. */
export function stripLiterals(q: string): string {
  let out = "";
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    const next = q[i + 1];
    if (c === "-" && next === "-") {
      const end = q.indexOf("\n", i);
      i = end === -1 ? q.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = q.indexOf("*/", i + 2);
      i = end === -1 ? q.length : end + 2;
      out += " ";
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < q.length) {
        if (q[j] === "'" && q[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (q[j] === "'") break;
        j++;
      }
      out += "'?'";
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const end = q.indexOf('"', i + 1);
      const ident = end === -1 ? q.slice(i + 1) : q.slice(i + 1, end);
      out += ident.toLowerCase();
      i = end === -1 ? q.length : end + 1;
      continue;
    }
    if (c === "$" && next === "$") {
      const end = q.indexOf("$$", i + 2);
      out += "'?'";
      i = end === -1 ? q.length : end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export type RelationRef = { schema: string | null; name: string };

const REL_RE = /\b(from|join)\s+((?:[a-z_][a-z0-9_]*)(?:\s*\.\s*[a-z_][a-z0-9_]*)?)/gi;
const FN_RE = /\b([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)\s*\(/gi;

/** Every relation named after FROM or JOIN in the stripped query (CTE names included). */
export function findRelations(stripped: string): RelationRef[] {
  const out: RelationRef[] = [];
  for (const m of stripped.matchAll(REL_RE)) {
    const parts = m[2].split(".").map((p) => p.trim().toLowerCase());
    if (parts.length === 2) out.push({ schema: parts[0], name: parts[1] });
    else out.push({ schema: null, name: parts[0] });
  }
  return out;
}

function cteNames(stripped: string): Set<string> {
  const names = new Set<string>();
  // `with a as (`, `, b as (`  — also recursive and column lists `a(x, y) as (`
  for (const m of stripped.matchAll(/\b(?:with(?:\s+recursive)?|,)\s*([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*\(/gi)) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

/**
 * Validate and normalise one model-written query. Returns the query with any
 * trailing semicolon removed. Throws `GuardError` with a message the model
 * can act on.
 */
export function guardSql(raw: string): string {
  const q = raw.trim().replace(/;+\s*$/, "");
  if (!q) throw new GuardError("The query is empty.");
  const stripped = stripLiterals(q);
  if (stripped.includes(";")) throw new GuardError("Only one statement is allowed (no semicolons).");
  if (!/^\s*(select|with|explain)\b/i.test(stripped)) {
    throw new GuardError("Only SELECT, WITH or EXPLAIN queries are allowed.");
  }
  if (/^\s*explain\s+(analyze|analyse)\b/i.test(stripped)) {
    throw new GuardError("EXPLAIN ANALYZE is not allowed; use plain EXPLAIN.");
  }
  const dml = DML_KEYWORDS.exec(stripped);
  if (dml) throw new GuardError(`The word ${dml[1].toUpperCase()} is not allowed in a read-only query.`);
  const fn = DENIED_FUNCTIONS.exec(stripped);
  if (fn) throw new GuardError(`The function ${fn[1]}() is not allowed.`);

  const ctes = cteNames(stripped);
  for (const rel of findRelations(stripped)) {
    if (rel.schema === null) {
      if (ctes.has(rel.name)) continue;
      if (rel.name.startsWith("pg_")) throw new GuardError(`${rel.name} is a system catalog and is not allowed.`);
      if (!PUBLIC.has(rel.name)) {
        throw new GuardError(`Unknown relation "${rel.name}". Use one of the public views (${[...PUBLIC].join(", ")}) or an internal.mv_* view.`);
      }
      continue;
    }
    if (rel.schema === "public") {
      if (!PUBLIC.has(rel.name)) throw new GuardError(`public.${rel.name} is not one of the allowed views.`);
      continue;
    }
    if (rel.schema === "internal") {
      if (MATVIEWS.has(rel.name) || INTERNAL_FUNCTIONS.has(rel.name)) continue;
      throw new GuardError(`internal.${rel.name} is not allowed; only internal.mv_* views and internal.similar_orgs() / hybrid_search() are.`);
    }
    throw new GuardError(`Schema "${rel.schema}" is not allowed.`);
  }
  for (const m of stripped.matchAll(FN_RE)) {
    const schema = m[1].toLowerCase();
    const name = m[2].toLowerCase();
    if (schema === "internal" && !INTERNAL_FUNCTIONS.has(name)) throw new GuardError(`internal.${name}() is not allowed.`);
    if (schema !== "internal" && schema !== "public") {
      // alias.column( would not parse as a call; anything else is a schema we do not expose.
      throw new GuardError(`Schema "${schema}" is not allowed.`);
    }
  }
  return q;
}

/** EXPLAIN passes through; everything else is wrapped so the row cap is enforced server-side. */
export function wrapWithLimit(q: string, cap = ROW_CAP): string {
  if (/^\s*explain\b/i.test(q)) return q;
  return `select * from (\n${q}\n) _q limit ${cap}`;
}

export function isExplain(q: string): boolean {
  return /^\s*explain\b/i.test(q);
}

/** Values as the UI and the model see them: dates as YYYY-MM-DD, bigints as strings, objects as JSON. */
export function serializeValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") return v;
  return JSON.stringify(v);
}

export type GuardedResult = {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
  rowCount: number;
  ms: number;
  capped: boolean;
};

/** Compact aligned text table for the model (at most `maxRows`). */
export function textTable(res: GuardedResult, maxRows = 60): string {
  if (res.rows.length === 0) return "(0 rows)";
  const shown = res.rows.slice(0, maxRows);
  const cells = shown.map((r) => r.map((v) => (v === null ? "∅" : String(v))));
  const widths = res.columns.map((c, i) => Math.min(48, Math.max(c.length, ...cells.map((r) => r[i]?.length ?? 0))));
  const line = (vals: string[]) => vals.map((v, i) => (v ?? "").slice(0, 48).padEnd(widths[i])).join("  ");
  const out = [line(res.columns), ...cells.map(line)];
  const footer =
    shown.length < res.rowCount || res.capped
      ? `\n(${res.rowCount} rows returned${res.capped ? `, capped at ${ROW_CAP}` : ""}; showing ${shown.length})`
      : `\n(${res.rowCount} rows)`;
  return out.join("\n") + footer;
}

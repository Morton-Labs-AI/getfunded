/**
 * Pure SQL guard for model-written queries (one type-only import; unit-tested
 * in tests/unit/ai/sql-guard.test.ts).
 *
 * The guard is an ALLOWLIST. A query passes only when every part of it is
 * something we have named in advance; anything we did not think of is
 * refused, not waved through. The layers, none of which depends on the prompt:
 *
 *   1. one statement, shaped `select ...` or `with ... select ...`      ← here
 *      (no EXPLAIN, no semicolons after literal stripping)
 *   2. a lexer that mirrors Postgres: '' strings, $$ and $tag$ quotes,
 *      "quoted" identifiers, line comments and nested block comments. Escape strings
 *      (E'...'), Unicode strings (U&'...'), positional parameters ($1),
 *      backslashes and non-ASCII outside quotes are refused outright so the
 *      guard and the server can never read the text differently            ← here
 *   3. relations: every item in a FROM list (after FROM, JOIN or a comma, in
 *      any depth of parentheses) must be a CTE defined in the query, one of
 *      the public views, or one of the internal mv_* views. Any other
 *      schema (pg_catalog, information_schema, getfunded, ...) is refused
 *      wherever it appears                                                  ← here
 *   4. functions: every `name(` must be in a list of ordinary SQL functions
 *      (aggregates, math, string, date/time, conditionals, arrays, JSON,
 *      full-text, trigram). Catalog, file, XML-of-query and settings
 *      functions are not on it, so they cannot be called                   ← here
 *   5. keywords that change shape or meaning (DML, TABLE, ONLY, LATERAL,
 *      INTO, SET, FOR UPDATE ...) are refused outside string literals        ← here
 *   6. the `funder_ro` role is read-only at the role level, can SELECT only
 *      what this file lists (migration getfunded_0010), and runs in an
 *      explicit READ ONLY transaction with search_path = public and a 15 s
 *      statement timeout; the query goes to the server over the extended
 *      protocol, so the server itself refuses a second statement           ← lib/ai/ask.ts
 *   7. LIMIT wrap at 500 rows                                               ← wrapWithLimit()
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

import type { ColumnType } from "./sse";

export const ROW_CAP = 500;

/**
 * The relations the analyst may read. These two lists are the contract with
 * migration getfunded_0010 (which grants funder_ro exactly these and nothing
 * else) and with scripts/db-ping.mjs (which checks the live grants against
 * them). Change one, change all three.
 */
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

/**
 * Ordinary SQL functions the analyst may call, by bare name. Nothing here
 * reads a file, runs a query, changes a setting, sleeps, or touches the
 * catalog. Type names are included because `numeric(12,2)` lexes like a call.
 */
export const ALLOWED_FUNCTIONS = [
  // aggregates
  "count", "sum", "avg", "min", "max", "array_agg", "string_agg", "json_agg", "jsonb_agg",
  "json_object_agg", "jsonb_object_agg", "bool_and", "bool_or", "every", "bit_and", "bit_or",
  "stddev", "stddev_pop", "stddev_samp", "variance", "var_pop", "var_samp",
  "percentile_cont", "percentile_disc", "mode", "corr", "covar_pop", "covar_samp",
  // window
  "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile", "lag", "lead",
  "first_value", "last_value", "nth_value",
  // math
  "abs", "ceil", "ceiling", "floor", "round", "trunc", "sign", "sqrt", "cbrt", "power", "exp",
  "ln", "log", "log10", "mod", "div", "pi", "random", "width_bucket", "greatest", "least",
  // strings
  "lower", "upper", "initcap", "length", "char_length", "character_length", "octet_length",
  "substring", "substr", "left", "right", "trim", "ltrim", "rtrim", "btrim", "lpad", "rpad",
  "replace", "regexp_replace", "regexp_match", "regexp_matches", "regexp_split_to_array",
  "regexp_split_to_table", "regexp_count", "regexp_like", "regexp_substr", "split_part", "position", "strpos", "concat",
  "concat_ws", "repeat", "reverse", "translate", "starts_with", "overlay", "to_char", "to_number",
  "format",
  // trigram (pg_trgm) and full text
  "similarity", "word_similarity", "strict_word_similarity", "show_trgm",
  "to_tsvector", "to_tsquery", "plainto_tsquery", "phraseto_tsquery", "websearch_to_tsquery",
  "ts_rank", "ts_rank_cd", "ts_headline",
  // date and time
  "now", "current_timestamp", "current_date", "current_time", "localtimestamp", "localtime",
  "date_trunc", "date_part", "extract", "age", "make_date", "make_time", "make_timestamp",
  "make_timestamptz", "make_interval", "to_date", "to_timestamp", "date_bin", "isfinite",
  "justify_days", "justify_hours", "justify_interval",
  // conditionals and nulls
  "coalesce", "nullif", "num_nonnulls", "num_nulls", "cast", "row", "array", "grouping",
  // arrays
  "array_length", "cardinality", "array_to_string", "string_to_array", "unnest", "array_position",
  "array_positions", "array_remove", "array_replace", "array_append", "array_prepend", "array_cat",
  "array_upper", "array_lower", "array_ndims", "generate_series", "generate_subscripts",
  // json
  "to_json", "to_jsonb", "json_build_object", "jsonb_build_object", "json_build_array",
  "jsonb_build_array", "json_array_elements", "jsonb_array_elements", "json_array_elements_text",
  "jsonb_array_elements_text", "json_each", "jsonb_each", "json_each_text", "jsonb_each_text",
  "json_object_keys", "jsonb_object_keys", "json_extract_path", "jsonb_extract_path",
  "json_extract_path_text", "jsonb_extract_path_text", "json_typeof", "jsonb_typeof",
  "json_array_length", "jsonb_array_length", "jsonb_pretty", "row_to_json", "jsonb_strip_nulls",
  // type names that take parameters (casts), e.g. numeric(12,2), varchar(40)
  "numeric", "decimal", "varchar", "char", "character", "bit", "time", "timestamp", "timestamptz",
  "interval", "float", "int", "integer", "bigint", "smallint", "text", "boolean", "bool", "date",
  "real", "uuid",
] as const;

const PUBLIC = new Set<string>(ALLOWED_PUBLIC_VIEWS);
const MATVIEWS = new Set<string>(ALLOWED_MATVIEWS);
const FUNCTIONS = new Set<string>(ALLOWED_FUNCTIONS);

/** Qualifiers that may never appear before a dot, in any position. */
const DENIED_SCHEMAS = new Set([
  "pg_catalog", "information_schema", "pg_temp", "pg_toast", "getfunded", "auth", "dnw",
  "community", "storage", "vault", "cron", "realtime", "supabase_migrations", "graphql",
  "graphql_public", "extensions", "net", "pgsodium",
]);

/** Keywords that start a different kind of statement or change what a SELECT does. */
const DENIED_KEYWORDS = new Set([
  "insert", "update", "delete", "truncate", "drop", "alter", "create", "grant", "revoke", "copy",
  "vacuum", "analyze", "analyse", "refresh", "reindex", "cluster", "lock", "listen", "notify",
  "unlisten", "discard", "reset", "begin", "commit", "rollback", "savepoint", "release", "abort",
  "start", "prepare", "execute", "deallocate", "do", "call", "merge", "import", "security",
  "comment", "into", "set", "show", "explain", "declare", "load", "checkpoint", "returning",
]);

/** From-list keywords we refuse outright, each with the hint the model needs. */
const DENIED_FROM_KEYWORDS: Record<string, string> = {
  table: "TABLE is not allowed; write SELECT ... FROM instead.",
  only: "ONLY is not allowed; use LIMIT n instead of FETCH ... ROWS ONLY.",
  lateral: "LATERAL is not allowed; use a plain subquery or a join instead.",
  tablesample: "TABLESAMPLE is not allowed.",
};

/** Words that are followed by `(` without being a function call. */
const PAREN_KEYWORDS = new Set([
  "in", "exists", "any", "all", "some", "values", "on", "using", "over", "filter", "from", "join",
  "and", "or", "not", "when", "then", "else", "as", "between", "like", "ilike", "similar",
  "distinct", "where", "having", "by", "limit", "offset", "select", "union", "intersect", "except",
  "with", "recursive", "case", "end", "is", "null", "true", "false", "zone", "order", "partition",
  "rows", "range", "groups", "window", "preceding", "following", "unbounded", "current", "exclude",
  "ties", "nulls", "first", "last", "asc", "desc", "collate", "escape", "to", "at", "group",
  "within", "materialized", "ordinality", "fetch", "next", "cross", "natural", "inner", "full",
  "outer", "cube", "rollup", "sets", "symmetric", "asymmetric", "isnull", "notnull", "of",
]);

/** Keywords that end a FROM list. (`on` and `using` stay inside it.) */
const FROM_END = new Set([
  "where", "group", "having", "window", "order", "limit", "offset", "fetch", "for", "union",
  "intersect", "except", "returning",
]);

const KEYWORDS = new Set<string>([
  ...PAREN_KEYWORDS, ...FROM_END, ...DENIED_KEYWORDS, ...Object.keys(DENIED_FROM_KEYWORDS),
  "left", "right", "lateral",
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const SIMPLE_IDENT = /^[a-z_][a-z0-9_]*$/;
const QUOTED_PLACEHOLDER = "_quoted_identifier_";

/**
 * Replace string literals, dollar-quoted strings and comments with
 * placeholders, and lower-case quoted identifiers, so the scanners below see
 * exactly the tokens the server will see. Throws `GuardError` on anything
 * that could make the two read the text differently.
 */
export function stripLiterals(q: string): string {
  let out = "";
  let i = 0;
  const n = q.length;
  const prev = (k: number): string => (k > 0 ? q[k - 1] : "");

  while (i < n) {
    const c = q[i];
    const next = q[i + 1];

    if (c === "-" && next === "-") {
      const end = q.indexOf("\n", i);
      out += " ";
      i = end === -1 ? n : end;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (q[j] === "/" && q[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (q[j] === "*" && q[j + 1] === "/") {
          depth--;
          j += 2;
        } else j++;
      }
      if (depth > 0) throw new GuardError("Unterminated comment.");
      out += " ";
      i = j;
      continue;
    }
    if (c === "'") {
      // E'...' (backslash escapes) and U&'...' (unicode escapes) would need a
      // second lexer; refuse them. B'...' and X'...' have no escapes.
      const p1 = prev(i);
      const p2 = prev(i - 1);
      if ((p1 === "e" || p1 === "E") && !(IDENT_START.test(p2) && p2 !== "")) {
        throw new GuardError("Escape strings (E'...') are not allowed; write the text in plain quotes.");
      }
      if (p1 === "&" && (p2 === "u" || p2 === "U")) {
        throw new GuardError("Unicode escape strings (U&'...') are not allowed.");
      }
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (q[j] === "'") {
          if (q[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) throw new GuardError("Unterminated string literal.");
      out += "'?'";
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let ident = "";
      let closed = false;
      while (j < n) {
        if (q[j] === '"') {
          if (q[j + 1] === '"') {
            ident += '"';
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        ident += q[j];
        j++;
      }
      if (!closed) throw new GuardError("Unterminated quoted identifier.");
      const lowered = ident.toLowerCase();
      out += SIMPLE_IDENT.test(lowered) ? lowered : ` ${QUOTED_PLACEHOLDER} `;
      i = j + 1;
      continue;
    }
    if (c === "$") {
      if (IDENT_CHAR.test(prev(i))) {
        throw new GuardError("The $ character is not allowed in names.");
      }
      // $$ ... $$ or $tag$ ... $tag$
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(q.slice(i));
      if (!m) throw new GuardError("Positional parameters ($1) are not allowed; write the value in the query.");
      const open = m[0];
      const end = q.indexOf(open, i + open.length);
      if (end === -1) throw new GuardError("Unterminated dollar-quoted string.");
      out += "'?'";
      i = end + open.length;
      continue;
    }
    if (c === "\\") throw new GuardError("Backslashes are not allowed outside quotes.");
    const code = c.charCodeAt(0);
    if (code > 126 || (code < 32 && c !== "\n" && c !== "\t" && c !== "\r")) {
      throw new GuardError("Only plain ASCII is allowed outside quotes.");
    }
    out += c;
    i++;
  }
  return out;
}

/* -------------------------------------------------------------- tokens */

type Token = { kind: "ident" | "number" | "string" | "punct"; text: string };

// Numbers never swallow a following word: `1from` must still show the FROM.
const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_]*|'\?'|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+|::|->>|->|#>>|#>|@@|<->|<=|>=|<>|!=|\|\||[^\sA-Za-z0-9_]/g;

/** Tokens of a stripped query. Identifiers are lower-cased; keywords are identifiers. */
export function tokenize(stripped: string): Token[] {
  const out: Token[] = [];
  for (const m of stripped.matchAll(TOKEN_RE)) {
    const t = m[0];
    if (t === "'?'") out.push({ kind: "string", text: t });
    else if (/^[A-Za-z_]/.test(t)) out.push({ kind: "ident", text: t.toLowerCase() });
    else if (/^[0-9.]/.test(t) && t !== ".") out.push({ kind: "number", text: t });
    else out.push({ kind: "punct", text: t });
  }
  return out;
}

export type RelationRef = { schema: string | null; name: string };
export type FunctionRef = { schema: string | null; name: string };

type Frame = {
  /** A SELECT has appeared in this frame, so a FROM here starts a from-list. */
  sawSelect: boolean;
  /** Inside the from-list of this frame: commas separate relation items. */
  inFrom: boolean;
  /** The next identifier is a relation item (right after FROM, JOIN or a from-list comma). */
  expectRel: boolean;
};

/** Index of the `)` that closes the `(` at `open`, or -1. */
function matchingParen(tokens: Token[], open: number): number {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.kind !== "punct") continue;
    if (t.text === "(") depth++;
    else if (t.text === ")") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** `name(` right after WITH/RECURSIVE/`,` and followed by `as (` is a CTE column list, not a call. */
function isCteColumnList(tokens: Token[], nameIdx: number, parenIdx: number): boolean {
  const before = tokens[nameIdx - 1];
  if (!before || !((before.kind === "ident" && (before.text === "with" || before.text === "recursive")) || (before.kind === "punct" && before.text === ","))) {
    return false;
  }
  const close = matchingParen(tokens, parenIdx);
  if (close === -1) return false;
  const a = tokens[close + 1];
  const b = tokens[close + 2];
  return Boolean(a && a.kind === "ident" && a.text === "as" && b && ((b.kind === "punct" && b.text === "(") || (b.kind === "ident" && (b.text === "not" || b.text === "materialized"))));
}

/**
 * Walk the tokens once and collect every relation item (after FROM, JOIN or
 * a from-list comma, through any parentheses) and every function call.
 * Throws for unbalanced parentheses, three-part names and refused keywords.
 */
export function scanQuery(tokens: Token[]): { relations: RelationRef[]; functions: FunctionRef[] } {
  const relations: RelationRef[] = [];
  const functions: FunctionRef[] = [];
  const stack: Frame[] = [{ sawSelect: false, inFrom: false, expectRel: false }];
  const top = () => stack[stack.length - 1];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const frame = top();

    if (t.kind === "punct") {
      if (t.text === "(") {
        const before = tokens[i - 1];
        if (before && before.kind === "ident" && !PAREN_KEYWORDS.has(before.text) && !isCteColumnList(tokens, i - 1, i)) {
          const dot = tokens[i - 2];
          const schemaTok = tokens[i - 3];
          const schema = dot && dot.kind === "punct" && dot.text === "." && schemaTok && schemaTok.kind === "ident" ? schemaTok.text : null;
          functions.push({ schema, name: before.text });
          stack.push({ sawSelect: false, inFrom: false, expectRel: false });
        } else if (frame.expectRel) {
          // A parenthesised join item: `from (a join b on ...)`.
          frame.expectRel = false;
          stack.push({ sawSelect: false, inFrom: true, expectRel: true });
        } else {
          stack.push({ sawSelect: false, inFrom: false, expectRel: false });
        }
        continue;
      }
      if (t.text === "[") {
        stack.push({ sawSelect: false, inFrom: false, expectRel: false });
        continue;
      }
      if (t.text === ")" || t.text === "]") {
        if (stack.length === 1) throw new GuardError("Unbalanced parentheses.");
        stack.pop();
        continue;
      }
      if (t.text === "," && frame.inFrom) frame.expectRel = true;
      continue;
    }

    if (t.kind !== "ident") continue;
    const word = t.text;

    if (word in DENIED_FROM_KEYWORDS) throw new GuardError(DENIED_FROM_KEYWORDS[word]);

    // A qualifier we never allow, wherever it appears (alias.column included).
    const after = tokens[i + 1];
    if (after && after.kind === "punct" && after.text === "." && DENIED_SCHEMAS.has(word)) {
      throw new GuardError(`Schema "${word}" is not allowed.`);
    }

    if (word === "select" || word === "values") {
      frame.sawSelect = frame.sawSelect || word === "select";
      frame.inFrom = false;
      frame.expectRel = false;
      continue;
    }
    if (word === "from") {
      // `extract(year from d)` and `substring(x from 1)` live in frames without a SELECT.
      if (frame.sawSelect) {
        frame.inFrom = true;
        frame.expectRel = true;
      }
      continue;
    }
    if (word === "join") {
      frame.inFrom = true;
      frame.expectRel = true;
      continue;
    }
    if (FROM_END.has(word)) {
      frame.inFrom = false;
      frame.expectRel = false;
      continue;
    }
    if (!frame.expectRel) continue;
    if (KEYWORDS.has(word)) continue;

    // The relation item: name or schema.name, unless it is a function call in FROM.
    let schema: string | null = null;
    let name = word;
    let j = i;
    if (tokens[j + 1]?.kind === "punct" && tokens[j + 1].text === "." && tokens[j + 2]?.kind === "ident") {
      schema = word;
      name = tokens[j + 2].text;
      j += 2;
      if (tokens[j + 1]?.kind === "punct" && tokens[j + 1].text === ".") {
        throw new GuardError("Three-part names (database.schema.table) are not allowed.");
      }
    }
    frame.expectRel = false;
    const call = tokens[j + 1]?.kind === "punct" && tokens[j + 1].text === "(";
    if (!call) relations.push({ schema, name });
    i = j;
  }
  if (stack.length !== 1) throw new GuardError("Unbalanced parentheses.");
  return { relations, functions };
}

/** Every relation item in the FROM lists of a stripped query (CTE names included). */
export function findRelations(stripped: string): RelationRef[] {
  return scanQuery(tokenize(stripped)).relations;
}

/** Every function call in a stripped query. */
export function findFunctions(stripped: string): FunctionRef[] {
  return scanQuery(tokenize(stripped)).functions;
}

/** CTE names: `with a as (`, `with recursive a(x) as (`, `, b as materialized (`. */
export function cteNames(stripped: string): Set<string> {
  const names = new Set<string>();
  // No \b before the comma: `(select 1), u as (` has no word boundary there.
  const re = /(?:\bwith(?:\s+recursive)?\b|,)\s*([a-z_][a-z0-9_]*)\s*(?:\([^()]*\))?\s+as\s+(?:(?:not\s+)?materialized\s+)?\(/gi;
  for (const m of stripped.matchAll(re)) names.add(m[1].toLowerCase());
  return names;
}

const PUBLIC_LIST = [...ALLOWED_PUBLIC_VIEWS].join(", ");

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
  if (/^\s*explain\b/i.test(stripped)) throw new GuardError("EXPLAIN is not allowed; write the SELECT itself.");
  if (!/^\s*(select|with)\b/i.test(stripped)) throw new GuardError("Only SELECT or WITH ... SELECT queries are allowed.");

  const tokens = tokenize(stripped);
  for (const t of tokens) {
    if (t.kind === "ident" && DENIED_KEYWORDS.has(t.text)) {
      throw new GuardError(`The word ${t.text.toUpperCase()} is not allowed in a read-only query.`);
    }
  }

  const { relations, functions } = scanQuery(tokens);

  const ctes = cteNames(stripped);
  for (const c of ctes) {
    if (c.startsWith("pg_")) throw new GuardError(`"${c}" is a reserved name; call the CTE something else.`);
  }

  for (const rel of relations) {
    if (rel.name === QUOTED_PLACEHOLDER || rel.schema === QUOTED_PLACEHOLDER) {
      throw new GuardError("Quoted names with spaces or symbols are not allowed for relations.");
    }
    if (rel.schema === null) {
      if (ctes.has(rel.name)) continue;
      if (rel.name.startsWith("pg_")) throw new GuardError(`${rel.name} is a system catalog and is not allowed.`);
      if (!PUBLIC.has(rel.name)) {
        throw new GuardError(`Unknown relation "${rel.name}". Use one of the public views (${PUBLIC_LIST}) or an internal.mv_* view, schema-qualified.`);
      }
      continue;
    }
    if (rel.schema === "public") {
      if (!PUBLIC.has(rel.name)) throw new GuardError(`public.${rel.name} is not one of the allowed views (${PUBLIC_LIST}).`);
      continue;
    }
    if (rel.schema === "internal") {
      if (MATVIEWS.has(rel.name)) continue;
      throw new GuardError(`internal.${rel.name} is not allowed; only these internal views are: ${[...ALLOWED_MATVIEWS].join(", ")}.`);
    }
    throw new GuardError(`Schema "${rel.schema}" is not allowed.`);
  }

  for (const fn of functions) {
    if (fn.schema === null || fn.schema === "public") {
      if (!FUNCTIONS.has(fn.name)) throw new GuardError(`The function ${fn.name}() is not allowed. Use ordinary SQL functions (aggregates, math, string, date/time, coalesce/nullif).`);
      continue;
    }
    throw new GuardError(`${fn.schema}.${fn.name}() is not allowed; call ordinary SQL functions without a schema.`);
  }
  return q;
}

/** Wrap the query so the row cap is enforced server-side. */
export function wrapWithLimit(q: string, cap = ROW_CAP): string {
  return `select * from (\n${q}\n) _q limit ${cap}`;
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
  /** Column types by position (`pgTypeName`), when the driver reported them. */
  types?: ColumnType[];
  rows: Array<Array<string | number | boolean | null>>;
  rowCount: number;
  ms: number;
  capped: boolean;
};

/** The pg_type oids postgres.js reports on `result.columns[i].type`, for the common types. */
const PG_TYPE_NAMES: Record<number, ColumnType> = {
  20: "int", // int8
  21: "int", // int2
  23: "int", // int4
  1700: "numeric",
  700: "float", // float4
  701: "float", // float8
  1082: "date",
  1114: "timestamp",
  1184: "timestamp", // timestamptz
  16: "bool",
  25: "text",
  1043: "text", // varchar
  1042: "text", // bpchar
  19: "text", // name
  2950: "text", // uuid
};

/** The column type for a postgres.js type oid; anything we do not know is `unknown`. */
export function pgTypeName(oid: number | null | undefined): ColumnType {
  if (typeof oid !== "number") return "unknown";
  return PG_TYPE_NAMES[oid] ?? "unknown";
}

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

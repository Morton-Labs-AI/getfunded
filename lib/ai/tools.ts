import type Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import {
  GuardError,
  guardSql,
  serializeValue,
  ROW_CAP,
  type GuardedResult,
} from "./sql-guard";

async function runGuardedQuery(raw: string): Promise<GuardedResult> {
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
        : serializeValue(r[c])
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

/** SSE side-channel: tools emit UI events (sql / rows / chart) while returning
 *  compact text to the model. */
export type Emit = (obj: unknown) => void;

export const DB_TOOLS: Anthropic.Tool[] = [
  {
    name: "run_query",
    description:
      "Run a read-only SQL query (SELECT/WITH/EXPLAIN) against the Open Funder Database. " +
      "Single statement. Results are capped at 500 rows server-side; you receive up to 100. " +
      "Prefer the mv_* materialized views for whole-database aggregates.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "The SQL query." },
        purpose: {
          type: "string",
          description:
            "Plain-English caption of what this query does, shown to the user (e.g. 'Full-text search over 2.32M grant records, sorted by amount').",
        },
      },
      required: ["sql", "purpose"],
    },
  },
  {
    name: "search_orgs",
    description:
      "Resolve an organization name to candidate records (id, name, type, state, size, identifiers). " +
      "Weighted full-text search with trigram fallback for misspellings. Use BEFORE joining on a named entity.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The organization name to resolve." },
        limit: { type: "number", description: "Max candidates (default 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "render_chart",
    description:
      "Render a chart in the UI from data you already aggregated with run_query. " +
      "Use for rankings (bar), time series (line), or compositions (pie). Max 100 categories, 5 series.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["bar", "line", "pie", "scatter"] },
        title: { type: "string" },
        x_label: { type: "string" },
        y_label: { type: "string" },
        y_unit: {
          type: "string",
          enum: ["usd", "count"],
          description: "Formats axis/tooltip values.",
        },
        categories: { type: "array", items: { type: "string" } },
        series: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              data: { type: "array", items: { type: "number" } },
            },
            required: ["name", "data"],
          },
        },
      },
      required: ["kind", "title", "categories", "series"],
    },
  },
];

/** Compact aligned text table for the model (≤ maxRows). */
function textTable(
  columns: string[],
  rows: unknown[][],
  rowCount: number,
  capped: boolean,
  maxRows = 100
): string {
  if (rows.length === 0) return "(0 rows)";
  const shown = rows.slice(0, maxRows);
  const cells = shown.map((r) => r.map((v) => (v === null ? "∅" : String(v))));
  const widths = columns.map((c, i) =>
    Math.min(48, Math.max(c.length, ...cells.map((r) => r[i]?.length ?? 0)))
  );
  const line = (vals: string[]) =>
    vals.map((v, i) => (v ?? "").slice(0, 48).padEnd(widths[i])).join("  ");
  const out = [line(columns), ...cells.map(line)];
  const footer =
    shown.length < rowCount || capped
      ? `\n(${rowCount} rows returned${capped ? ", capped at 500" : ""}; showing ${shown.length})`
      : `\n(${rowCount} rows)`;
  return out.join("\n") + footer;
}

export async function runDbTool(
  name: string,
  input: Record<string, unknown>,
  emit: Emit
): Promise<string> {
  try {
    if (name === "run_query") {
      const q = String(input.sql ?? "");
      const purpose = String(input.purpose ?? "");
      emit({ type: "sql", sql: q, purpose });
      try {
        const res = await runGuardedQuery(q);
        emit({
          type: "rows",
          columns: res.columns,
          rows: res.rows,
          total: res.rowCount,
          ms: res.ms,
          capped: res.capped,
        });
        return textTable(res.columns, res.rows, res.rowCount, res.capped);
      } catch (err) {
        const message =
          err instanceof GuardError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        emit({ type: "sql_error", message });
        return `QUERY ERROR: ${message}\nFix the query and try again (one retry).`;
      }
    }

    if (name === "search_orgs") {
      const query = String(input.query ?? "").trim();
      const limit = Math.min(Number(input.limit) || 8, 20);
      if (!query) return "ERROR: empty query";
      const fts = await sql`
        select o.id, o.name, o.org_type, o.state,
               coalesce(o.asset_amount, o.aum, o.fund_size)::text as size,
               (select string_agg(i.id_type || ':' || i.id_value, ' ')
                  from internal.org_identifiers i where i.org_id = o.id) as ids
        from internal.organizations o, websearch_to_tsquery('english', ${query}) q
        where o.search_tsv @@ q
        order by ts_rank_cd(o.search_tsv, q) desc,
                 coalesce(o.asset_amount, o.aum, o.fund_size) desc nulls last
        limit ${limit}`;
      let rows = fts;
      if (rows.length < 3) {
        const trgm = await sql`
          select o.id, o.name, o.org_type, o.state,
                 coalesce(o.asset_amount, o.aum, o.fund_size)::text as size,
                 (select string_agg(i.id_type || ':' || i.id_value, ' ')
                    from internal.org_identifiers i where i.org_id = o.id) as ids
          from internal.organizations o
          where o.name % ${query}
          order by similarity(o.name, ${query}) desc
          limit ${limit}`;
        const seen = new Set(rows.map((r) => r.id));
        rows = [...rows, ...trgm.filter((r) => !seen.has(r.id))].slice(0, limit);
      }
      if (rows.length === 0)
        return `No organizations match "${query}" (FTS + trigram). This may be a documented absence.`;
      return rows
        .map(
          (r) =>
            `${r.id} | ${r.name} | ${r.org_type} | ${r.state ?? "∅"} | size=${r.size ?? "∅"} | ${r.ids ?? ""}`
        )
        .join("\n");
    }

    if (name === "render_chart") {
      const categories = (input.categories as unknown[]) ?? [];
      const series = (input.series as { name: string; data: number[] }[]) ?? [];
      if (categories.length > 100 || series.length > 5)
        return "ERROR: chart too large (max 100 categories, 5 series). Aggregate further.";
      emit({ type: "chart", spec: input });
      return "rendered";
    }

    return `Unknown tool: ${name}`;
  } catch (err) {
    return `TOOL ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
}

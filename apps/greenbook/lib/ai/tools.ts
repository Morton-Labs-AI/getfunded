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

  // Contact-channel privacy mask, tier-aware and FAIL-CLOSED.
  //
  // Some contacts are now genuinely public (role inboxes a foundation printed
  // on its own return for applicants), so blanket masking would hide data we
  // publish. But run_query takes arbitrary SQL and the server cannot re-derive
  // a row's tier from the text. So: the projection is the contract. If the
  // result carries a publishability column, mask only the non-public rows; if
  // it does not, mask everything exactly as before. A model that forgets to
  // select publishability gets the old behaviour, never a leak.
  const maskContacts = /contact_channels/i.test(q);
  const valueIdx = columns.indexOf("value");
  const pubIdx = columns.findIndex(
    (c) => c === "publishability" || c === "is_public"
  );

  const rows = rowsIn.map((r) => {
    const rowIsPublic =
      pubIdx >= 0 &&
      (r[columns[pubIdx]] === "public" || r[columns[pubIdx]] === true);
    return columns.map((c, i) =>
      maskContacts && i === valueIdx && r[c] != null && !rowIsPublic
        ? "•• on file (internal) ••"
        : serializeValue(r[c])
    );
  });

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
    name: "semantic_funder_search",
    description:
      "Thematic funder discovery over aggregated giving-behavior documents (hybrid " +
      "vector + keyword search with rank fusion). Use for 'who funds X' questions — " +
      "it finds funders whose ACTUAL grants/awards/funds relate to a topic even when " +
      "their names don't contain it, and it demotes false keyword matches (e.g. " +
      "medical 'bone fusion' foundations for a fusion-energy query). For resolving a " +
      "NAMED organization, use search_orgs instead. Follow up with run_query to pull " +
      "grants-paid evidence for the top candidates.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of what needs funding, e.g. 'fusion energy simulation software'.",
        },
        kinds: {
          type: "array",
          items: {
            type: "string",
            enum: ["foundation", "company", "adviser", "program"],
          },
          description: "Restrict document kinds (default: all).",
        },
        org_types: { type: "array", items: { type: "string" } },
        state: { type: "string", description: "Two-letter state filter." },
        app_postures: {
          type: "array",
          items: { type: "string", enum: ["open", "preselected_only", "unknown"] },
          description:
            "Filter by whether the funder accepts unsolicited applications, " +
            "from Part XV of its latest parsed 990-PF. 'open' = does not " +
            "report preselected-only. 'preselected_only' = states it funds " +
            "only preselected organizations. 'unknown' = the return carries " +
            "no Part XV block — an ABSENCE of a statement, not a closed door, " +
            "and it covers EVERY grantmaking public charity (they file 990, " +
            "which has no Part XV). Passing ['open'] alone therefore drops " +
            "large well-known funders like Hewlett and ClimateWorks; prefer " +
            "['open','unknown'] unless the user explicitly wants only " +
            "foundations that have said yes in writing.",
        },
        min_distributions: {
          type: "number",
          description:
            "Minimum money actually PAID OUT per year (qualifying " +
            "distributions, falling back to charitable disbursements or " +
            "annualized observed grants). Prefer this over min_size when the " +
            "user describes giving volume — min_size is assets held, this is " +
            "the flow.",
        },
        min_size: { type: "number", description: "Minimum assets/AUM in dollars." },
        limit: { type: "number", description: "Max results (default 15)." },
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
        where o.search_tsv @@ q and o.canonical_org_id is null
        order by ts_rank_cd(o.search_tsv, q) desc,
                 coalesce(o.asset_amount, o.aum, o.fund_size) desc nulls last
        limit ${limit}`;
      let rows = [...fts];
      if (rows.length < 3) {
        const trgm = await sql`
          select o.id, o.name, o.org_type, o.state,
                 coalesce(o.asset_amount, o.aum, o.fund_size)::text as size,
                 (select string_agg(i.id_type || ':' || i.id_value, ' ')
                    from internal.org_identifiers i where i.org_id = o.id) as ids
          from internal.organizations o
          where o.name % ${query} and o.canonical_org_id is null
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

    if (name === "semantic_funder_search") {
      const { embedQuery, vecLiteral } = await import("./embed");
      const query = String(input.query ?? "").trim();
      if (!query) return "ERROR: empty query";
      const limit = Math.min(Number(input.limit) || 15, 30);
      let vec: number[];
      try {
        vec = await embedQuery(query);
      } catch (err) {
        return `SEMANTIC SEARCH UNAVAILABLE: ${err instanceof Error ? err.message : err}. Fall back to run_query FTS.`;
      }
      const t0 = performance.now();
      const rows = await sql`
        select * from internal.hybrid_search(
          ${query},
          ${vecLiteral(vec)}::extensions.halfvec(512),
          ${limit},
          ${(input.kinds as string[]) ?? null},
          ${(input.org_types as string[]) ?? null},
          ${(input.state as string) ?? null},
          ${(input.min_size as number) ?? null},
          ${(input.app_postures as string[]) ?? null},
          ${(input.min_distributions as number) ?? null}
        )`;
      const ms = Math.round(performance.now() - t0);
      emit({
        type: "rows",
        columns: ["org_id", "name", "doc_kind", "state", "size_amount",
                  "app_posture", "annual_distributions", "rrf", "snippet"],
        rows: rows.map((r) => [
          r.org_id ?? r.program_id,
          r.name,
          r.doc_kind,
          r.state,
          r.size_amount,
          r.app_posture,
          r.annual_distributions,
          Number(r.rrf).toFixed(4),
          r.snippet,
        ]),
        total: rows.length,
        ms,
      });
      if (rows.length === 0)
        return "0 results. The corpus covers foundations with grants on file, SBIR companies, advisers, and federal programs.";
      return rows
        .map(
          (r) =>
            `${r.org_id ?? "program:" + r.program_id} | ${r.name} | ${r.doc_kind} | ${r.state ?? "∅"} | ${r.app_posture ?? "∅"} | rrf=${Number(r.rrf).toFixed(4)} | ${String(r.snippet).slice(0, 140)}`
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

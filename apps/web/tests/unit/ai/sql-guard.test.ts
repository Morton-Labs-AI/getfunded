// @vitest-environment node
/**
 * The SQL guard for model-written queries (lib/ai/sql-guard.ts) and the way
 * lib/ai/ask.ts runs what passes it.
 *
 * The guard is an allowlist: every relation, function and keyword must be one
 * we named in advance. Each `it` below is a shape that once slipped past a
 * denylist, or a legitimate analyst query that must keep working.
 */
import { describe, expect, it, vi } from "vitest";

import { EXTENDED_PROTOCOL, executeGuardedSql } from "@/lib/ai/ask";
import {
  ALLOWED_FUNCTIONS,
  ALLOWED_MATVIEWS,
  ALLOWED_PUBLIC_VIEWS,
  GuardError,
  cteNames,
  findFunctions,
  findRelations,
  pgTypeName,
  guardSql,
  stripLiterals,
  textTable,
  wrapWithLimit,
} from "@/lib/ai/sql-guard";

const rejects = (sql: string, message?: RegExp) => {
  let err: unknown = null;
  try {
    guardSql(sql);
  } catch (e) {
    err = e;
  }
  expect(err, `expected the guard to reject: ${sql}`).toBeInstanceOf(GuardError);
  if (message) expect((err as GuardError).message).toMatch(message);
};

const accepts = (sql: string) => {
  expect(() => guardSql(sql), `expected the guard to accept: ${sql}`).not.toThrow();
};

describe("stripLiterals", () => {
  it("replaces plain strings and keeps the shape of the query", () => {
    expect(stripLiterals("select 'a;b' from x -- c\n")).toBe("select '?' from x  \n");
    expect(stripLiterals("select 'it''s'")).toBe("select '?'");
  });

  it("handles $$ and tagged dollar quotes, including quotes inside them", () => {
    expect(stripLiterals("select $$a ' ; b$$")).toBe("select '?'");
    expect(stripLiterals("select $a$ ' $$ ; drop $a$")).toBe("select '?'");
    expect(stripLiterals("select $tag_1$x$tag_1$, 1")).toBe("select '?', 1");
  });

  it("refuses an unterminated dollar quote instead of hiding the rest of the query", () => {
    expect(() => stripLiterals("select $a$ oops")).toThrow(/Unterminated dollar/);
    expect(() => stripLiterals("select $$ oops")).toThrow(/Unterminated dollar/);
  });

  it("refuses positional parameters and $ inside names", () => {
    expect(() => stripLiterals("select $1")).toThrow(/Positional parameters/);
    expect(() => stripLiterals("select a$b from t")).toThrow(/\$ character/);
  });

  it("refuses escape and unicode strings, but not an identifier ending in e before a string", () => {
    expect(() => stripLiterals("select e'\\'' from pg_shadow --'")).toThrow(/Escape strings/);
    expect(() => stripLiterals("select E'x'")).toThrow(/Escape strings/);
    expect(() => stripLiterals("select 1e'x'")).toThrow(/Escape strings/);
    expect(() => stripLiterals("select u&'d\\0061ta'")).toThrow(/Unicode escape/);
    expect(stripLiterals("select case'x' when 'x' then 1 end")).toBe("select case'?' when '?' then 1 end");
    expect(stripLiterals("select date'2024-01-01'")).toBe("select date'?'");
  });

  it("handles nested block comments the way Postgres does", () => {
    expect(stripLiterals("select 1 /* a /* b */ c */ + 2")).toBe("select 1   + 2");
    expect(() => stripLiterals("select 1 /* a /* b */")).toThrow(/Unterminated comment/);
  });

  it("lower-cases quoted identifiers and neutralises odd ones", () => {
    expect(stripLiterals('select "Name" from "Public"."Organizations"')).toBe("select name from public.organizations");
    expect(stripLiterals('select "a b" from t')).toBe("select  _quoted_identifier_  from t");
    expect(() => stripLiterals('select "a from t')).toThrow(/Unterminated quoted/);
  });

  it("refuses backslashes and non-ASCII outside quotes", () => {
    expect(() => stripLiterals("select 1 \\ 2")).toThrow(/Backslashes/);
    expect(() => stripLiterals("select nämé from t")).toThrow(/ASCII/);
    expect(stripLiterals("select 'nämé' from t")).toBe("select '?' from t");
  });
});

describe("findRelations / findFunctions", () => {
  it("finds every item of a FROM list, through commas and parentheses", () => {
    const rels = findRelations(stripLiterals("select * from public.organizations o, internal.contact_channels c join ((pg_shadow)) s on true"));
    expect(rels).toEqual([
      { schema: "public", name: "organizations" },
      { schema: "internal", name: "contact_channels" },
      { schema: null, name: "pg_shadow" },
    ]);
  });

  it("does not mistake alias.column, extract(... from ...) or a select list for relations", () => {
    const rels = findRelations(stripLiterals("select o.name, extract(year from f.tax_period_end), substring(o.name from 1 for 3) from public.organizations o join public.filings f on f.org_id = o.id"));
    expect(rels).toEqual([
      { schema: "public", name: "organizations" },
      { schema: "public", name: "filings" },
    ]);
  });

  it("finds relations in subqueries, CTEs, EXISTS and IN", () => {
    const sql = "with x as (select 1 from a) select (select 1 from b) from x where exists (select 1 from c) and 1 in (select 1 from d)";
    expect(findRelations(stripLiterals(sql)).map((r) => r.name)).toEqual(["a", "b", "x", "c", "d"]);
  });

  it("records function calls with their schema and skips function-like keywords", () => {
    const fns = findFunctions(stripLiterals("select count(*), internal.similar_orgs('x'), coalesce(a, b) from t where x in (1) and exists (select 1)"));
    expect(fns).toEqual([
      { schema: null, name: "count" },
      { schema: "internal", name: "similar_orgs" },
      { schema: null, name: "coalesce" },
    ]);
  });

  it("knows a CTE column list is not a function call", () => {
    expect(findFunctions(stripLiterals("with recursive t(n) as (select 1 union all select n + 1 from t where n < 5) select * from t"))).toEqual([]);
    expect(cteNames(stripLiterals("with recursive t(n) as (select 1), u as materialized (select 2) select 1"))).toEqual(new Set(["t", "u"]));
  });
});

describe("guardSql: statement shape", () => {
  it("accepts SELECT and WITH ... SELECT, with or without a trailing semicolon", () => {
    expect(guardSql("select 1;")).toBe("select 1");
    accepts("WITH x AS (SELECT 1 AS n) SELECT n FROM x");
  });

  it("refuses EXPLAIN, DML heads and empty input", () => {
    rejects("explain select 1", /EXPLAIN/);
    rejects("explain analyze select 1", /EXPLAIN/);
    rejects("update public.organizations set name = 'x'", /SELECT or WITH/);
    rejects("table internal.contact_channels", /SELECT or WITH/);
    rejects("   ", /empty/);
  });

  it("refuses a second statement even when the first is fine", () => {
    rejects("select 1; drop table x", /one statement/);
    rejects("select 1 -- c\n; select 2", /one statement/);
  });

  it("refuses DML and shape-changing words anywhere outside quotes", () => {
    rejects("with x as (insert into t values (1) returning 1) select 1", /INSERT/);
    rejects("select 1 into newtable", /INTO/);
    rejects("select * from public.organizations for update", /UPDATE/);
    rejects("select set_config('a', 'b', false)", /not allowed/);
    accepts("select 'insert into x; drop table y' as text_only");
  });
});

describe("guardSql: relations (allowlist)", () => {
  it("accepts the public views and the internal matviews, schema-qualified or bare", () => {
    for (const v of ALLOWED_PUBLIC_VIEWS) accepts(`select * from public.${v} limit 1`);
    for (const v of ALLOWED_PUBLIC_VIEWS) accepts(`select * from ${v} limit 1`);
    for (const v of ALLOWED_MATVIEWS) accepts(`select * from internal.${v} limit 1`);
    accepts('select * from "Public"."Organizations"');
    accepts("select * from PUBLIC . Organizations");
  });

  it("refuses internal tables that are not matviews, in every FROM position", () => {
    rejects("select * from internal.contact_channels", /internal\.contact_channels is not allowed/);
    rejects("select * from public.organizations o, internal.contact_channels c", /internal\.contact_channels/);
    rejects("select * from public.organizations o join internal.raw_files r on true", /internal\.raw_files/);
    rejects("select * from public.organizations o cross join internal.org_web_facts w", /internal\.org_web_facts/);
    rejects("select * from public.organizations where id in (select org_id from internal.contact_channels)", /internal\.contact_channels/);
    rejects("select (select count(*) from internal.filing_application_info)", /internal\.filing_application_info/);
    rejects("with c as (select * from internal.contact_channels) select * from c", /internal\.contact_channels/);
    rejects("select * from ((internal.contact_channels))", /internal\.contact_channels/);
    rejects("select * from (internal.contact_channels c join public.organizations o on o.id = c.org_id)", /internal\.contact_channels/);
  });

  it("refuses bare matview names (search_path is public) and unknown bare names", () => {
    rejects("select * from mv_org_latest_financials", /Unknown relation "mv_org_latest_financials"/);
    rejects("select * from contact_channels c, nope n", /Unknown relation "nope"/);
  });

  it("refuses system catalogs however they are spelled", () => {
    rejects("select * from pg_shadow", /system catalog/);
    rejects("select * from public.organizations, pg_shadow", /system catalog/);
    rejects("select * from pg_catalog.pg_tables", /Schema "pg_catalog"/);
    rejects("select * from information_schema.tables", /Schema "information_schema"/);
    rejects('select * from "pg_shadow"', /system catalog/);
    rejects("select pg_catalog.pg_shadow.passwd from public.organizations", /Schema "pg_catalog"/);
    rejects("select * from getfunded.workspaces", /Schema "getfunded"/);
    rejects("select auth.uid()", /Schema "auth"/);
    rejects("select * from dnw.contacts", /Schema "dnw"/);
    rejects("select * from mydb.public.organizations", /Three-part names/);
  });

  it("refuses TABLE, ONLY, LATERAL and TABLESAMPLE", () => {
    rejects("select * from (table internal.contact_channels) t", /TABLE is not allowed/);
    rejects("select * from only public.organizations", /ONLY is not allowed/);
    rejects("select * from public.organizations order by 1 fetch first 10 rows only", /ONLY is not allowed/);
    rejects("select * from public.organizations o cross join lateral (select 1) x", /LATERAL/);
    rejects("select * from public.organizations tablesample system (1)", /TABLESAMPLE/);
  });

  it("lets a CTE shadow a name and refuses CTEs named like catalogs", () => {
    accepts("with totals as (select funder_org_id, sum(amount) as total from public.funding_events where event_type = 'grant' group by 1) select o.name, t.total from totals t join public.organizations o on o.id = t.funder_org_id order by 2 desc limit 20");
    rejects("with pg_shadow as (select 1) select * from pg_shadow", /reserved name/);
  });

  it("refuses odd quoted relation names", () => {
    rejects('select * from "pg shadow"', /Quoted names/);
  });
});

describe("guardSql: functions (allowlist)", () => {
  it("accepts the ordinary analyst toolkit", () => {
    accepts("select count(*), sum(fe.amount), avg(fe.amount), min(fe.fiscal_year), max(fe.fiscal_year) from public.funding_events fe where fe.funder_org_id = '00000000-0000-4000-8000-000000000000' and fe.event_type = 'grant'");
    accepts("select o.name, similarity(o.name, 'meyer memorial') as s from public.organizations o where o.name % 'meyer memorial' order by s desc limit 10");
    accepts("select extract(year from fe.event_date) as y, round(avg(fe.amount)) from public.funding_events fe where fe.funder_org_id = 'x' group by 1 order by 1");
    accepts("select coalesce(fe.recipient_state, '??'), string_agg(distinct fe.recipient_name, ', ') from public.funding_events fe where fe.funder_org_id = 'x' group by 1");
    accepts("select nullif(left(pf.tax_period, 4), '')::int as fy, pf.tax_period_end::text from public.filings pf where pf.org_id = 'x' and pf.superseded_by_object_id is null");
    accepts("select amount::numeric(14,2), cast(fiscal_year as text), date_trunc('year', event_date), now() - interval '1 year' from public.funding_events limit 5");
    accepts("select rank() over (partition by state order by n desc), percentile_cont(0.5) within group (order by n) from internal.mv_org_state_counts group by state, n");
    accepts("select count(*) filter (where application_posture = 'open') from internal.mv_org_application_posture");
    accepts("select fy from generate_series(2015, 2024) as fy");
    accepts("select o.id, unnest(o.focus_areas) from public.organizations o where o.id = 'x'");
    accepts("select * from public.organizations o where o.state = any(array['TX', 'OK']) and o.id = any('{a,b}'::uuid[])");
    accepts("select jsonb_build_object('n', count(*)) from public.people");
    accepts("select regexp_replace(o.name, '\\s+', ' ', 'g') from public.organizations o limit 1");
  });

  it("refuses the SQL-executing XML builtins and every other unlisted function", () => {
    for (const fn of [
      "query_to_xml", "query_to_xmlschema", "query_to_xml_and_xmlschema", "cursor_to_xml", "cursor_to_xmlschema",
      "table_to_xml", "table_to_xmlschema", "table_to_xml_and_xmlschema", "schema_to_xml", "schema_to_xmlschema",
      "schema_to_xml_and_xmlschema", "database_to_xml", "database_to_xmlschema", "database_to_xml_and_xmlschema",
      "xpath_table", "pg_sleep", "pg_read_file", "pg_ls_dir", "current_setting", "set_config", "version",
      "pg_terminate_backend", "lo_import", "dblink", "current_schema", "inet_server_addr", "txid_current",
    ]) {
      rejects(`select ${fn}('x')`, new RegExp(`${fn}\\(\\) is not allowed`));
      rejects(`select pg_catalog.${fn}('x')`, /Schema "pg_catalog"/);
      rejects(`select * from ${fn}('x')`, new RegExp(`${fn}\\(\\) is not allowed`));
    }
    rejects("select xmlagg(query_to_xml('select 1', true, false, ''))", /xmlagg\(\) is not allowed/);
    rejects("select count(query_to_xml('select 1', true, false, ''))", /query_to_xml\(\) is not allowed/);
  });

  it("refuses schema-qualified functions, including the internal search doors", () => {
    rejects("select * from internal.similar_orgs('x', 12, null, null, null, null)", /internal\.similar_orgs\(\) is not allowed/);
    rejects("select * from internal.hybrid_search('x', null)", /internal\.hybrid_search\(\) is not allowed/);
    rejects("select internal.norm_name('x')", /internal\.norm_name\(\) is not allowed/);
    // pg_trgm lives in schema public, so public.<allowed function> stays callable.
    accepts("select public.similarity('a', 'b')");
    rejects("select public.pg_sleep(1)", /pg_sleep\(\) is not allowed/);
  });

  it("keeps every allowlisted function name lower-case and unique", () => {
    const set = new Set<string>(ALLOWED_FUNCTIONS);
    expect(set.size).toBe(ALLOWED_FUNCTIONS.length);
    for (const f of ALLOWED_FUNCTIONS) expect(f).toMatch(/^[a-z_][a-z0-9_]*$/);
    for (const bad of ["pg_sleep", "query_to_xml", "current_setting", "set_config", "pg_read_file", "dblink", "lo_import"]) {
      expect(set.has(bad)).toBe(false);
    }
  });
});

describe("guardSql: the cookbook keeps working", () => {
  it("accepts the three cookbook queries and the mock query", () => {
    accepts(
      "select o.id as org_id, o.name, o.city, o.state, m.qualifying_distributions, p.application_posture, p.fy " +
        "from internal.mv_org_application_posture p join public.organizations o on o.id = p.org_id " +
        "join internal.mv_org_latest_financials m on m.org_id = p.org_id " +
        "where p.application_posture = 'open' and o.state = 'TX' and m.qualifying_distributions >= 500000 " +
        "order by m.qualifying_distributions desc limit 50",
    );
    accepts(
      "select f.id as funder_org_id, f.name as funder, fe.recipient_name, fe.amount, fe.purpose_text, fe.fiscal_year " +
        "from public.funding_events fe join public.organizations f on f.id = fe.funder_org_id " +
        "where fe.event_type = 'grant' and fe.purpose_text ilike '%food bank%' and fe.recipient_state = 'OR' " +
        "order by fe.amount desc nulls last limit 50",
    );
    accepts("select fiscal_year, count(*) as grants, sum(amount) as total from public.funding_events where funder_org_id = '<uuid>' and event_type = 'grant' group by 1 order by 1");
    accepts("select org_type, n from internal.mv_org_type_counts order by n desc limit 10");
  });

  it("reports unbalanced parentheses", () => {
    rejects("select (1 from public.organizations", /Unbalanced/);
    rejects("select 1) from public.organizations", /Unbalanced/);
  });
});

describe("wrapWithLimit and textTable", () => {
  it("always wraps with the row cap", () => {
    expect(wrapWithLimit("select 1")).toBe("select * from (\nselect 1\n) _q limit 500");
    expect(wrapWithLimit("select 1 -- trailing comment")).toMatch(/\n\) _q limit 500$/);
  });

  it("renders a compact table with a footer", () => {
    const t = textTable({ columns: ["a", "b"], rows: [[1, null]], rowCount: 1, ms: 1, capped: false });
    expect(t).toContain("a  b");
    expect(t).toContain("1  ∅");
    expect(t).toContain("(1 rows)");
  });
});

describe("executeGuardedSql", () => {
  function fakePool(rows: Record<string, unknown>[] = []) {
    const unsafe = vi.fn(async (...args: unknown[]) => {
      void args;
      return rows as never;
    });
    const begin = vi.fn(async (_mode: string, fn: (tx: { unsafe: typeof unsafe }) => Promise<unknown>) => fn({ unsafe }));
    return { pool: { begin } as never, begin, unsafe };
  }

  it("runs the wrapped query over the extended protocol inside a read-only, pinned transaction", async () => {
    const { pool, begin, unsafe } = fakePool([{ n: 1 }]);
    const res = await executeGuardedSql(pool, "select 1 as n;", { statementTimeoutMs: 5000 });
    expect(begin).toHaveBeenCalledWith("read only", expect.any(Function));
    const calls = unsafe.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe("set local statement_timeout = '5000ms'");
    expect(calls[1]).toBe("set local search_path = public");
    expect(calls[2]).toBe("set local standard_conforming_strings = on");
    expect(calls[3]).toBe("select * from (\nselect 1 as n\n) _q limit 500");
    expect(unsafe.mock.calls[3][1]).toEqual([]);
    expect(unsafe.mock.calls[3][2]).toBe(EXTENDED_PROTOCOL);
    expect(EXTENDED_PROTOCOL).toEqual({ prepare: false, simple: false });
    expect(res).toMatchObject({ columns: ["n"], rows: [[1]], rowCount: 1, capped: false });
  });

  it("refuses before touching the pool when the guard rejects", async () => {
    const { pool, begin } = fakePool();
    await expect(executeGuardedSql(pool, "select * from internal.contact_channels")).rejects.toBeInstanceOf(GuardError);
    expect(begin).not.toHaveBeenCalled();
  });

  it("names each column's Postgres type from the driver's oids, unknown oids included", async () => {
    // postgres.js hangs RowDescription on the result array: { name, type: oid, ... } per column.
    const result = Object.assign([{ name: "Example Fund", n: 3, total: "1200.50", fy: 2024, since: new Date("2024-01-01T00:00:00Z"), open: true, blob: "x" }], {
      columns: [
        { name: "name", type: 25 },
        { name: "n", type: 20 },
        { name: "total", type: 1700 },
        { name: "fy", type: 23 },
        { name: "since", type: 1082 },
        { name: "open", type: 16 },
        { name: "blob", type: 3802 },
      ],
    });
    const { pool } = fakePool(result as never);
    const res = await executeGuardedSql(pool, "select 1");
    expect(res.columns).toEqual(["name", "n", "total", "fy", "since", "open", "blob"]);
    expect(res.types).toEqual(["text", "int", "numeric", "int", "date", "bool", "unknown"]);
    expect(res.rows[0]).toEqual(["Example Fund", 3, "1200.50", 2024, "2024-01-01", true, "x"]);
  });

  it("leaves types out when the driver reports no column metadata", async () => {
    const { pool } = fakePool([{ n: 1 }]);
    const res = await executeGuardedSql(pool, "select 1 as n");
    expect(res.columns).toEqual(["n"]);
    expect(res.types).toBeUndefined();
  });
});

describe("pgTypeName", () => {
  it("maps the common oids and calls everything else unknown", () => {
    expect([20, 21, 23].map(pgTypeName)).toEqual(["int", "int", "int"]);
    expect(pgTypeName(1700)).toBe("numeric");
    expect([700, 701].map(pgTypeName)).toEqual(["float", "float"]);
    expect(pgTypeName(1082)).toBe("date");
    expect([1114, 1184].map(pgTypeName)).toEqual(["timestamp", "timestamp"]);
    expect(pgTypeName(16)).toBe("bool");
    expect([25, 1043, 2950].map(pgTypeName)).toEqual(["text", "text", "text"]);
    expect(pgTypeName(3802)).toBe("unknown");
    expect(pgTypeName(undefined)).toBe("unknown");
  });
});

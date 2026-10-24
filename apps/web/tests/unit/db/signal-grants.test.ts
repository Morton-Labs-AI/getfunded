// @vitest-environment node
/**
 * The funder page's Signals query must run as the app role with exactly the
 * grants the web migrations give it.
 *
 * Regression for the October 2026 production error "permission denied for
 * table raw_files" (about 250,000 a day): the query joined
 * internal.raw_files (dataset_name, license_code) and internal.licensing_map,
 * but getfunded_0010 grants the app role only (id, sha256) on raw_files and
 * nothing on licensing_map. getfunded_0017 grants the licence-filtered view
 * public.funder_signals instead, and lib/queries/corpus/signals.ts reads it.
 *
 * The schema tests strip `-- @roles-begin corpus` blocks because PGlite has
 * no corpus. This test builds a small stand-in corpus (only the columns the
 * query and the view touch, the view copied from corpus migration 0035),
 * then applies the REAL corpus blocks of getfunded_0001, 0010, 0015 and 0017
 * in the order the hosted corpus saw them and runs the REAL query text as
 * getfunded_app.
 */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signalsForOrgSql, signalsForOrgsSql } from "@/lib/queries/corpus/signals";

import { readMigration, rolesBlocks } from "./harness";

const ORG = "11111111-1111-4111-8111-111111111111";

const STAND_IN_CORPUS = `
create schema internal;
create role getfunded_app nologin;

create table internal.licensing_map (
  license_code text primary key, license_name text not null, republishable boolean not null);
create table internal.raw_files (
  id bigint primary key, dataset_name text not null, source_url text,
  license_code text not null references internal.licensing_map, sha256 text not null);
create table internal.organizations (id uuid primary key, name text not null);
create table internal.signal_sources (id bigint primary key, slug text not null);
create table internal.funder_signals (
  id bigint primary key, url text not null, publisher text, headline text,
  published_at date, discovered_at timestamptz not null default now(),
  signal_type text, amount_usd numeric, amount_kind text,
  instruments text[], eligible_recipients text[], sectors text[], geographies text[],
  horizon_end date, summary text, action_hint text,
  extraction_model text, extraction_confidence real, reviewed_at timestamptz,
  status text not null, raw_source jsonb,
  raw_file_id bigint not null references internal.raw_files);
create table internal.funder_signal_orgs (
  signal_id bigint not null references internal.funder_signals,
  org_id uuid not null references internal.organizations,
  role text not null default 'subject', match_method text not null, confidence real not null default 1,
  primary key (signal_id, org_id, role));
`;

/**
 * Corpus migration 0035 came after getfunded_0001, whose grant loop gives the
 * app role every public view that existed THEN. So the view is created after
 * 0001's block runs, as it was on the hosted corpus.
 */
const CORPUS_0035_VIEW_AND_ROWS = `
-- Verbatim from corpus/migrations/0035_funder_signals.sql, section 5.
create view public.funder_signals as
select
  s.id, s.url, s.publisher, s.headline, s.published_at, s.discovered_at,
  s.signal_type, s.amount_usd, s.amount_kind, s.instruments, s.eligible_recipients,
  s.sectors, s.geographies, s.horizon_end, s.summary, s.action_hint,
  s.extraction_model, s.extraction_confidence, s.reviewed_at,
  rf.dataset_name as source_dataset, rf.source_url, lm.license_code, lm.license_name
from internal.funder_signals s
join internal.raw_files rf on rf.id = s.raw_file_id
join internal.licensing_map lm on lm.license_code = rf.license_code
where lm.republishable and s.status = 'published';

insert into internal.licensing_map values
  ('cc_by', 'CC BY 4.0', true), ('publisher_website', 'Publisher website', false);
insert into internal.raw_files values
  (1, 'getfunded_signals_run', null, 'cc_by', 'aaaa1111'),
  (2, 'publisher_page', 'https://example.invalid/page', 'publisher_website', 'bbbb2222');
insert into internal.organizations values ('${ORG}', 'Placeholder Foundation');
insert into internal.funder_signals (id, url, headline, published_at, status, raw_file_id) values
  (10, 'https://example.invalid/published', 'Published signal', '2026-10-01', 'published', 1),
  (11, 'https://example.invalid/candidate', 'Candidate signal', '2026-10-02', 'candidate', 1),
  (12, 'https://example.invalid/not-republishable', 'Not republishable', '2026-10-03', 'published', 2);
insert into internal.funder_signal_orgs (signal_id, org_id, match_method) values
  (10, '${ORG}', 'source_feed'), (11, '${ORG}', 'source_feed'), (12, '${ORG}', 'source_feed');
`;

/** The corpus-tagged grant block of a web migration, as the operator runs it. */
function corpusBlock(file: string): string {
  const blocks = rolesBlocks(readMigration(file), file).filter((b) => b.tag === "corpus");
  expect(blocks.length, `${file} has a corpus roles block`).toBe(1);
  return blocks[0]!.body;
}

describe("funder signals query as getfunded_app", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
    await pg.exec(STAND_IN_CORPUS);
    await pg.exec(corpusBlock("getfunded_0001_schema_and_roles.sql"));
    await pg.exec(CORPUS_0035_VIEW_AND_ROWS);
    for (const file of [
      "getfunded_0010_analyst_role_scope.sql",
      "getfunded_0015_signal_grants.sql",
      "getfunded_0017_signal_view_grant.sql",
    ]) {
      await pg.exec(corpusBlock(file));
    }
  });

  afterAll(async () => {
    await pg.close();
  });

  async function asApp<T>(sql: string, params: unknown[]): Promise<T[]> {
    return pg.transaction(async (tx) => {
      await tx.exec("set local role getfunded_app");
      return (await tx.query<T>(sql, params)).rows;
    });
  }

  it("reads published, republishable signals with dataset, licence and file hash", async () => {
    for (const withHash of [true, false]) {
      const rows = await asApp<{ id: string; source_dataset: string; license_name: string; sha256: string | null }>(
        signalsForOrgSql(withHash),
        [ORG, 12],
      );
      expect(rows).toEqual([
        expect.objectContaining({
          id: "10",
          source_dataset: "getfunded_signals_run",
          license_name: "CC BY 4.0",
          sha256: withHash ? "aaaa1111" : null,
        }),
      ]);
    }
    const many = await asApp<{ id: string }>(signalsForOrgsSql(true), [[ORG], 8]);
    expect(many.map((r) => r.id)).toEqual(["10"]);
  });

  it("still gives the app role nothing more on raw_files or licensing_map", async () => {
    await expect(asApp("select dataset_name from internal.raw_files", [])).rejects.toThrow(/permission denied/);
    await expect(asApp("select license_name from internal.licensing_map", [])).rejects.toThrow(/permission denied/);
  });
});

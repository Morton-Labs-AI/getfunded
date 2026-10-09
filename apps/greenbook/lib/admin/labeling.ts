import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adminSql as sql } from "./db";

/**
 * Server-side core of the funds labeling pass.
 *
 * BLINDING IS ENFORCED HERE, in the SQL: the pair-serving query does not
 * SELECT match_probability or features, so no route can leak them before a
 * decision. They are fetched only by recordDecision(), whose response is the
 * post-write "model said" reveal.
 */

export const JOB = "funds_adv_formd";
// Declared fixed n for the gate, fixed BEFORE any labeling of this class.
// Fixed-n is load-bearing — a Wilson bound assumes n chosen in advance — so
// this is a declared constant, never a stopping heuristic. At n=250 the pass
// line is 235/250 (0.9034) and 234/250 (0.8986) fails: <=15 not_match.
// progress() scopes to the current class (see below), so the failed class's
// labels do not count toward it.
export const TARGET_NON_UNSURE = 250;

// The gate class under test. Mirrors common.JOBS['funds'].strata[GATE_CLASS]
// in corpus/ exactly — keep the two in step.
//
// The PREVIOUS class (splink pairs selected on gamma_people >= 1) FAILED its
// gate on 2026-08-08: 227/252, Wilson low 0.858. It selected pairs on shared
// people, which the rubric below calls FAMILY-level evidence and explicitly
// not evidence of fund identity. This class inverts that correctly: the
// exact normalized name carries identity, and person overlap serves only as
// corroboration — what separates two unrelated "Growth Fund I LP"s.
export const GATE_CLASS = "nameonly_people";
const GATE_STRATUM = `
  el.method = 'deterministic:exact_name'
  and coalesce((el.features->>'people_overlap')::int, 0) >= 1`;

// ---------------------------------------------------------------------------
// Session seed — generated once, persisted, recorded. Ordering is
// md5(seed || id_a || id_b): stable across reloads, unrelated to probability.
// ---------------------------------------------------------------------------

// Keyed by gate class: a new class is a NEW fixed-n sample and must draw its
// own ordering rather than inherit the failed class's seed.
const SEED_FILE = path.join(process.cwd(), `.labeling-seed-${JOB}-${GATE_CLASS}`);

export function sessionSeed(): string {
  if (existsSync(SEED_FILE)) return readFileSync(SEED_FILE, "utf8").trim();
  const seed = randomUUID();
  writeFileSync(SEED_FILE, seed + "\n");
  return seed;
}

// ---------------------------------------------------------------------------
// Pair serving (blinded)
// ---------------------------------------------------------------------------

// Parked labels do NOT hide a pair: parking retires the old sample, so its
// pairs return to the pool and a fresh UI decision supersedes them (the
// uq_er_labels upsert overwrites label + labeled_by).
const UNLABELED = `
  not exists (select 1 from internal.er_labels l
              where l.job = el.job and l.id_a = el.id_a and l.id_b = el.id_b
                and l.labeled_by not like '%:parked')`;

export async function nextPair(seed: string): Promise<{ id_a: string; id_b: string } | null> {
  const rows = await sql<{ id_a: string; id_b: string }[]>`
    select el.id_a, el.id_b
    from internal.entity_links el
    where el.job = ${JOB}
      and ${sql.unsafe(GATE_STRATUM)}
      and ${sql.unsafe(UNLABELED)}
    order by md5(${seed} || el.id_a::text || el.id_b::text)
    limit 1`;
  return rows[0] ?? null;
}

// Scoped to the CURRENT gate class by joining through entity_links, not by
// labeled_by. The failed class's 252 labels are also labeled_by='ui', so a
// bare count would report 252/250 — done before the new pass began. Joining
// on the stratum is self-maintaining: it counts exactly the class under test,
// whatever earlier passes left behind. Parked labels are excluded, matching
// the data-repo gate.
export async function progress(): Promise<{ done: number; target: number }> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n
    from internal.er_labels l
    join internal.entity_links el
      on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
    where l.job = ${JOB}
      and l.label <> 'unsure'
      and l.labeled_by not like '%:parked'
      and ${sql.unsafe(GATE_STRATUM)}`;
  return { done: rows[0]?.n ?? 0, target: TARGET_NON_UNSURE };
}

// ---------------------------------------------------------------------------
// Pair detail (blinded payload for the card)
// ---------------------------------------------------------------------------

const US_STATES = new Set(
  ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH " +
   "NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP").split(" ")
);

export interface SideDetail {
  org_id: string;
  side: "ADV" | "FormD";
  name: string;
  name_normalized: string;
  state: string | null;
  state_note: string | null;
  gav: string | null;
  adviser: string | null;
  adviser_crd: string | null;
  offerings: number;
  id_types: string[];
  source_url: string | null;
  dataset_name: string;
  source_record_locator: string;
  sha256_short: string;
  people: { key: string; name: string; title: string | null }[];
}

export interface PairDetail {
  id_a: string;
  id_b: string;
  sides: SideDetail[];              // ADV side first when determinable
  shared_people: { name_a: string; title_a: string | null; name_b: string; title_b: string | null }[];
}

export async function pairDetail(id_a: string, id_b: string): Promise<PairDetail> {
  const orgs = await sql`
    select o.id::text as org_id, o.name, o.name_normalized, o.state,
           o.fund_size::text as gav,
           adv.name as adviser,
           adv_crd.id_value as adviser_crd,
           (select count(*)::int from internal.funding_events fe
             where fe.recipient_org_id = o.id and fe.event_type = 'reg_d_offering') as offerings,
           coalesce((select array_agg(i.id_type order by i.id_type)
             from internal.org_identifiers i where i.org_id = o.id), '{}') as id_types,
           (select i.id_value from internal.org_identifiers i
             where i.org_id = o.id and i.id_type = 'cik' limit 1) as cik,
           rf.dataset_name, o.source_record_locator, left(rf.sha256, 12) as sha256_short
    from internal.organizations o
    join internal.raw_files rf on rf.id = o.raw_file_id
    left join lateral (
      select a.id, a.name from internal.relationships r
      join internal.organizations a on a.id = r.from_org_id
      where r.to_org_id = o.id and r.rel_type = 'manages_fund' limit 1
    ) adv on true
    left join internal.org_identifiers adv_crd
      on adv_crd.org_id = adv.id and adv_crd.id_type = 'crd'
    where o.id = any(${[id_a, id_b]}::uuid[])`;

  // People per side, keyed token-sorted (same key the model compares).
  // ADV side: the ADVISER's owners/executives; Form D side: the FUND's
  // executives/directors — mirroring the funds job's frame SQL.
  const people = await sql`
    with advside as (
      select f.id as org_id, p.full_name, coalesce(pr.title, p.primary_title) as title,
             (select string_agg(t, ' ' order by t)
                from unnest(string_to_array(internal.norm_name(p.full_name), ' ')) t) as key
      from internal.organizations f
      join internal.relationships mf on mf.to_org_id = f.id and mf.rel_type = 'manages_fund'
      join internal.relationships pr
        on pr.to_org_id = mf.from_org_id and pr.rel_type in ('owner_of', 'executive_of')
       and pr.from_person_id is not null
      join internal.people p on p.id = pr.from_person_id
      where f.id = any(${[id_a, id_b]}::uuid[])
        and internal.norm_name(p.full_name) !~ ${"\\m(LLC|L L C|LTD|INC|CORP|GP|LP|L P|LLP|FUND|FUNDS|GROUP|PARTNERS|CAPITAL|MANAGEMENT|HOLDINGS|ADVISORS|ADVISERS|COMPANY|TRUST)\\M"}
    ), formdside as (
      select f.id as org_id, p.full_name, coalesce(pr.title, p.primary_title) as title,
             (select string_agg(t, ' ' order by t)
                from unnest(string_to_array(internal.norm_name(p.full_name), ' ')) t) as key
      from internal.organizations f
      join internal.relationships pr
        on pr.to_org_id = f.id and pr.rel_type in ('executive_of', 'director_of')
       and pr.from_person_id is not null
      join internal.people p on p.id = pr.from_person_id
      where f.id = any(${[id_a, id_b]}::uuid[])
        and internal.norm_name(p.full_name) !~ ${"\\m(LLC|L L C|LTD|INC|CORP|GP|LP|L P|LLP|FUND|FUNDS|GROUP|PARTNERS|CAPITAL|MANAGEMENT|HOLDINGS|ADVISORS|ADVISERS|COMPANY|TRUST)\\M"}
    )
    select org_id::text, full_name, title, key, 'adv' as arm from advside
    union all
    select org_id::text, full_name, title, key, 'formd' as arm from formdside`;

  const sides: SideDetail[] = orgs.map((o) => {
    const idTypes = o.id_types as string[];
    const isAdv = idTypes.includes("sec_private_fund_id");
    const sourceUrl = isAdv
      ? o.adviser_crd
        ? `https://adviserinfo.sec.gov/firm/summary/${o.adviser_crd}`
        : null
      : o.cik
        ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${o.cik}`
        : null;
    const st = (o.state as string | null)?.trim() || null;
    const sidePeople = people
      .filter((p) => p.org_id === o.org_id)
      .map((p) => ({ key: p.key as string, name: p.full_name as string, title: p.title as string | null }));
    // Dedupe by key within a side
    const seen = new Set<string>();
    const uniquePeople = sidePeople.filter((p) =>
      seen.has(p.key) ? false : (seen.add(p.key), true)
    );
    return {
      org_id: o.org_id as string,
      side: isAdv ? "ADV" : "FormD",
      name: o.name as string,
      name_normalized: o.name_normalized as string,
      state: st,
      state_note: st && !US_STATES.has(st) ? "non-US or undefined state code" : null,
      gav: o.gav as string | null,
      adviser: o.adviser as string | null,
      adviser_crd: o.adviser_crd as string | null,
      offerings: o.offerings as number,
      id_types: idTypes,
      source_url: sourceUrl,
      dataset_name: o.dataset_name as string,
      source_record_locator: o.source_record_locator as string,
      sha256_short: o.sha256_short as string,
      people: uniquePeople,
    };
  });
  sides.sort((a, b) => (a.side === "ADV" ? -1 : 0) - (b.side === "ADV" ? -1 : 0));

  const [sa, sb] = sides;
  // Dropped-token tolerance, matching funds.backfill_people_overlap()'s rule.
  // Strict key equality would show NOTHING here: measured 2026-08-08, zero of
  // the 21,067 exact-name pairs share an exactly equal person key, because ADV
  // Schedule A/B records middle names ("Harris, Roberta, Joann") and Form D
  // does not ("Joann Harris"). Since person corroboration is what DEFINES this
  // class, a strict match would blank out the card's key evidence on every
  // pair the labeler sees.
  const toks = (k: string) => new Set(k.split(" ").filter(Boolean));
  const corroborates = (a: string, b: string) => {
    const ta = toks(a), tb = toks(b);
    if (ta.size < 2 || tb.size < 2) return false;
    const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
    return [...small].every((t) => big.has(t));
  };
  const shared = (sa?.people ?? []).flatMap((p) => {
    const other = (sb?.people ?? []).find((q) => corroborates(p.key, q.key));
    return other
      ? [{ name_a: p.name, title_a: p.title, name_b: other.name, title_b: other.title }]
      : [];
  });

  return { id_a, id_b, sides, shared_people: shared };
}

// ---------------------------------------------------------------------------
// Decision write (+ post-write reveal) and undo
// ---------------------------------------------------------------------------

const DECISION_TO_LABEL: Record<string, string> = {
  y: "match",
  n: "not_match",
  u: "unsure",
};

export async function recordDecision(
  id_a: string,
  id_b: string,
  decision: string,
  notes: string | null
): Promise<{ revealed: { match_probability: number | null; features: unknown } }> {
  const label = DECISION_TO_LABEL[decision];
  if (!label) throw new Error(`invalid decision ${decision}`);

  // Importer invariant: the pair must exist in entity_links exactly as
  // given (pairs are canonicalized id_a < id_b at predict time). Orphan
  // writes fail loudly — they would silently vanish from the gate join.
  const link = await sql`
    select match_probability, features from internal.entity_links
    where job = ${JOB} and id_a = ${id_a}::uuid and id_b = ${id_b}::uuid`;
  if (link.length === 0) {
    throw new Error(
      `ORPHAN PAIR REFUSED: (${id_a}, ${id_b}) not in entity_links for ${JOB} — ` +
      "check id ordering (id_a < id_b) and job"
    );
  }

  await sql`
    insert into internal.er_labels (job, id_a, id_b, label, labeled_by, notes)
    values (${JOB}, ${id_a}::uuid, ${id_b}::uuid, ${label}, 'ui', ${notes})
    on conflict on constraint uq_er_labels
    do update set label = excluded.label,
                  labeled_by = excluded.labeled_by,
                  notes = excluded.notes`;

  // The reveal — only ever returned AFTER the write above.
  return {
    revealed: {
      match_probability:
        link[0].match_probability === null ? null : Number(link[0].match_probability),
      features: link[0].features,
    },
  };
}

export async function undoDecision(id_a: string, id_b: string): Promise<{ undone: boolean }> {
  // Precise, stateless undo: the client names the pair it last labeled;
  // only a 'ui' row can be deleted. The pair re-enters the pool at its
  // seeded position (which is the front, since serving picks the first
  // unlabeled pair in seed order... it returns wherever the seed put it).
  const rows = await sql`
    delete from internal.er_labels
    where job = ${JOB} and id_a = ${id_a}::uuid and id_b = ${id_b}::uuid
      and labeled_by = 'ui'
    returning id`;
  return { undone: rows.length > 0 };
}

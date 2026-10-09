import { adminSql as sql } from "./db";
import { JOB, TARGET_NON_UNSURE } from "./labeling";

/**
 * The verification-suite view. Reads THE SAME numbers `resolve eval funds`
 * and `resolve status` produce — same class CASE, same parked exclusion,
 * same Wilson formula (z = 1.96) — so the two must agree exactly.
 */

// Verbatim mirror of common.JOBS['funds'].class_case_sql (corpus/).
const CLASS_CASE = `
  case when el.method = 'deterministic:exact_name' then 'nameonly'
       when coalesce((el.features->>'gamma_people')::int, 0) >= 1 then 'people'
       else 'band' end`;

const PARKED = `l.labeled_by not like '%:parked'`;

export function wilsonLow(correct: number, n: number): number {
  if (n === 0) return 0;
  const p = correct / n;
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - margin) / denom;
}

export interface ResultsPayload {
  progress: { done: number; target: number };
  complete: boolean;
  seed: string | null;
  by_stratum_source: {
    cls: string; labeled_by: string; label: string; n: number;
  }[];
  gate: { n: number; correct: number; wilson_low: number; certified: boolean };
  threshold_ladder: { threshold: number; n: number; correct: number; wilson_low: number }[];
  bands: { band: string; n: number; correct: number; unsure: number }[];
  model_agreement: { at_auto_threshold: number | null; at_half: number | null; n: number };
}

export async function results(seed: string | null): Promise<ResultsPayload> {
  const labeled = await sql`
    select l.label, l.labeled_by, ${sql.unsafe(CLASS_CASE)} as cls,
           el.match_probability::float8 as p
    from internal.er_labels l
    join internal.entity_links el
      on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
    where l.job = ${JOB} and ${sql.unsafe(PARKED)}`;

  const nonUnsure = labeled.filter((r) => r.label !== "unsure");
  const uiDone = nonUnsure.filter((r) => r.labeled_by === "ui").length;

  // by stratum × source × label
  const agg = new Map<string, number>();
  for (const r of labeled) {
    const k = `${r.cls}|${r.labeled_by}|${r.label}`;
    agg.set(k, (agg.get(k) ?? 0) + 1);
  }
  const by_stratum_source = [...agg.entries()]
    .map(([k, n]) => {
      const [cls, labeled_by, label] = k.split("|");
      return { cls, labeled_by, label, n };
    })
    .sort((a, b) =>
      a.cls.localeCompare(b.cls) || a.labeled_by.localeCompare(b.labeled_by) ||
      a.label.localeCompare(b.label));

  // The gate: pooled over all non-parked sources, people class only —
  // identical to funds.apply's gate query.
  const gatePop = nonUnsure.filter((r) => r.cls === "people");
  const gateCorrect = gatePop.filter((r) => r.label === "match").length;
  const gateLow = wilsonLow(gateCorrect, gatePop.length);

  // Pre-registered threshold ladder over the gate population.
  const ladder = [0.5, 0.8, 0.9, 0.95, 0.99].map((t) => {
    const pop = gatePop.filter((r) => r.p !== null && r.p >= t);
    const correct = pop.filter((r) => r.label === "match").length;
    return { threshold: t, n: pop.length, correct, wilson_low: wilsonLow(correct, pop.length) };
  });

  // Probability bands (people class, incl. unsure so coverage is visible).
  const bandDefs: [string, (p: number) => boolean][] = [
    ["0.20–0.50", (p) => p >= 0.2 && p < 0.5],
    ["0.50–0.80", (p) => p >= 0.5 && p < 0.8],
    ["0.80–0.95", (p) => p >= 0.8 && p < 0.95],
    ["0.95–0.99", (p) => p >= 0.95 && p < 0.99],
    ["0.99+", (p) => p >= 0.99],
  ];
  const peopleAll = labeled.filter((r) => r.cls === "people" && r.p !== null);
  const bands = bandDefs.map(([band, fn]) => {
    const pop = peopleAll.filter((r) => fn(r.p as number));
    return {
      band,
      n: pop.length,
      correct: pop.filter((r) => r.label === "match").length,
      unsure: pop.filter((r) => r.label === "unsure").length,
    };
  });

  // Agreement with the model's binary call.
  const withP = gatePop.filter((r) => r.p !== null);
  const agree = (t: number) =>
    withP.length === 0
      ? null
      : withP.filter((r) => (r.p! >= t) === (r.label === "match")).length / withP.length;

  return {
    progress: { done: uiDone, target: TARGET_NON_UNSURE },
    complete: uiDone >= TARGET_NON_UNSURE,
    seed,
    by_stratum_source,
    gate: {
      n: gatePop.length,
      correct: gateCorrect,
      wilson_low: gateLow,
      certified: gatePop.length >= 100 && gateLow > 0.9,
    },
    threshold_ladder: ladder,
    bands,
    model_agreement: { at_auto_threshold: agree(0.99), at_half: agree(0.5), n: withP.length },
  };
}

// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREDIT_COSTS,
  PAID_PLAN_IDS,
  PLANS,
  PLAN_IDS,
  can,
  dailyCreditsFor,
  isPaidPlanId,
  isPlanId,
  planFor,
  type Feature,
  type PlanId,
} from "@/lib/plans";

const DOC = resolve(process.cwd(), "../../docs/PLANS.md");

type Row = Record<string, string>;

/** Parse the first GitHub-flavoured table that starts with `| <firstHeader> |`. */
function parseTable(markdown: string, firstHeader: string): Row[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(`| ${firstHeader} |`));
  if (start < 0) throw new Error(`table starting with "${firstHeader}" not found in PLANS.md`);
  const headers = lines[start].split("|").slice(1, -1).map((h) => h.trim());
  const rows: Row[] = [];
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    rows.push(Object.fromEntries(headers.map((h, idx) => [h, cells[idx] ?? ""])));
  }
  return rows;
}

const num = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
const numOrNull = (s: string) => (/unlimited/i.test(s) ? null : num(s));
const priceCents = (s: string) => Math.round(num(s) * 100);

describe("lib/plans.ts matches docs/PLANS.md", () => {
  const md = readFileSync(DOC, "utf8");
  const planRows = parseTable(md, "Plan");
  const creditRows = parseTable(md, "Feature");

  it("documents exactly the five public plans, in order", () => {
    expect(planRows.map((r) => r.Plan.toLowerCase())).toEqual(["free", "starter", "pro", "team", "enterprise"]);
    expect(PLAN_IDS.filter((id) => PLANS[id].public)).toEqual(["free", "starter", "pro", "team", "enterprise"]);
  });

  it.each(planRows.map((r) => [r.Plan.toLowerCase() as PlanId, r] as const))("%s: numbers match", (id, row) => {
    const plan = PLANS[id];
    expect(plan.price_cents_monthly).toBe(priceCents(row.Price));
    expect(plan.members).toBe(numOrNull(row.Members));
    expect(plan.monthly_credits).toBe(num(row["AI credits / month"]));
    expect(plan.daily_credits).toBe(Math.ceil(num(row["AI credits / month"]) / 3));
    expect(plan.saved_funders_limit).toBe(numOrNull(row["Saved funders"]));
    expect(plan.pipelines_limit).toBe(numOrNull(row.Pipelines));
  });

  it.each(planRows.map((r) => [r.Plan.toLowerCase() as PlanId, r] as const))("%s: export and outreach flags match", (id, row) => {
    const plan = PLANS[id];
    const exportCell = row.Export;
    const outreach = row.Outreach;
    if (/^\d+ rows/i.test(exportCell)) {
      expect(plan.export).toBe("limited100");
      expect(plan.export_rows).toBe(num(exportCell));
    } else {
      expect(plan.export).toBe("full");
    }
    expect(plan.features.reports).toBe(/reports|everything/i.test(exportCell));
    expect(plan.features.api).toBe(/\bAPI\b|everything/i.test(exportCell));
    expect(plan.features.send_gmail).toBe(/gmail|everything in pro|dedicated/i.test(outreach));
    // PLANS.md says "follow-ups that stop when a funder replies" for what the code calls sequences.
    expect(plan.features.sequences).toBe(/sequences|follow-ups|dedicated/i.test(outreach));
    expect(plan.features.shared_knowledge).toBe(/shared knowledge|dedicated/i.test(outreach));
    expect(plan.features.dedicated_outreach).toBe(/dedicated outreach/i.test(outreach));
    // Drafting and the other model features are on every plan ("uses credits").
    expect(plan.features.draft).toBe(true);
    expect(plan.features.nl_filter && plan.features.ask && plan.features.fit && plan.features.research).toBe(true);
  });

  it("credit prices match the 'What a credit buys' table", () => {
    const byKeyword: Array<[RegExp, Feature]> = [
      [/natural-language search filter/i, "filter"],
      [/ask the analyst/i, "ask"],
      [/outreach draft/i, "draft"],
      [/fit analysis/i, "fit"],
      [/research dossier/i, "research"],
    ];
    const seen = new Set<Feature>();
    for (const row of creditRows) {
      const match = byKeyword.find(([re]) => re.test(row.Feature));
      expect(match, `unmapped feature row: ${row.Feature}`).toBeDefined();
      const feature = match![1];
      seen.add(feature);
      expect(CREDIT_COSTS[feature]).toBe(num(row.Credits));
    }
    expect([...seen].sort()).toEqual(Object.keys(CREDIT_COSTS).sort());
  });

  it("the daily cap is one third of monthly and Team+ may switch it off", () => {
    expect(dailyCreditsFor(25)).toBe(9);
    expect(dailyCreditsFor(3000)).toBe(1000);
    expect(dailyCreditsFor(null)).toBeNull();
    expect(PLANS.free.can_disable_daily_cap).toBe(false);
    expect(PLANS.pro.can_disable_daily_cap).toBe(false);
    expect(PLANS.team.can_disable_daily_cap).toBe(true);
    expect(PLANS.enterprise.can_disable_daily_cap).toBe(true);
  });

  it("paid plans name their Stripe price env var; free and unlimited do not", () => {
    for (const id of PAID_PLAN_IDS) expect(PLANS[id].stripe_price_env).toBe(`STRIPE_PRICE_${id.toUpperCase()}`);
    expect(PLANS.free.stripe_price_env).toBeNull();
    expect(PLANS.unlimited.stripe_price_env).toBeNull();
    expect(PLANS.unlimited.public).toBe(false);
    expect(PLANS.unlimited.monthly_credits).toBeNull();
    expect(PLANS.unlimited.daily_credits).toBeNull();
  });
});

describe("planFor", () => {
  const env = { SELF_HOSTED: undefined } as Record<string, string | undefined>;

  it("falls back to free for unknown or missing plans", () => {
    expect(planFor({ plan: "gold" }, null, env).id).toBe("free");
    expect(planFor(null, null, env).id).toBe("free");
    expect(planFor({ plan: "pro" }, null, env).id).toBe("pro");
    expect(planFor({ plan: "pro" }, null, env).overridden).toBe(false);
  });

  it("SELF_HOSTED puts every workspace on unlimited", () => {
    const p = planFor({ plan: "free" }, { monthly_credits: 10 }, { SELF_HOSTED: "true" });
    expect(p.id).toBe("unlimited");
    expect(p.monthly_credits).toBeNull();
    expect(p.overridden).toBe(false);
    expect(planFor({ plan: "free" }, null, { SELF_HOSTED: "1" }).id).toBe("unlimited");
    expect(planFor({ plan: "free" }, null, { SELF_HOSTED: "false" }).id).toBe("free");
  });

  it("applies steward overrides and recomputes the daily cap", () => {
    const p = planFor({ plan: "free" }, { monthly_credits: 300, members: 5 }, env);
    expect(p.base_plan).toBe("free");
    expect(p.overridden).toBe(true);
    expect(p.monthly_credits).toBe(300);
    expect(p.daily_credits).toBe(100);
    expect(p.members).toBe(5);
    expect(p.features.send_gmail).toBe(false); // flags come from the base plan
  });

  it("ignores empty overrides", () => {
    expect(planFor({ plan: "starter" }, { monthly_credits: null, members: null }, env).overridden).toBe(false);
  });
});

describe("can / guards", () => {
  it("answers by plan object or id", () => {
    expect(can("free", "send_gmail")).toBe(false);
    expect(can("pro", "send_gmail")).toBe(true);
    expect(can("team", "api")).toBe(true);
    expect(can("pro", "api")).toBe(false);
    expect(can(PLANS.enterprise, "dedicated_outreach")).toBe(true);
    expect(can("nonsense", "api")).toBe(false);
    expect(can(null, "ask")).toBe(true);
  });
  it("type guards", () => {
    expect(isPlanId("team")).toBe(true);
    expect(isPlanId("gold")).toBe(false);
    expect(isPaidPlanId("free")).toBe(false);
    expect(isPaidPlanId("enterprise")).toBe(true);
  });
});

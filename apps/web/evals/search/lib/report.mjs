/** The markdown scorecard a run writes, for people and for the next agent. */

const diff = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : null);
const pct = (x) => (x === null || x === undefined ? "n/a" : `${Math.round(x * 100)}%`);
const num = (x) => (x === null || x === undefined ? "n/a" : String(x));
const fmt = (key, v) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : key.includes("_ms") ? `${v} ms` : key.includes("jaccard") || key.endsWith("lift") ? v.toFixed(2) : typeof v === "number" && v <= 1 && v >= -1 ? pct(v) : num(v));

export function renderReport({ meta, metrics, guards, causes }) {
  const s = metrics.summary;
  const d = metrics.details;
  const lines = [];
  lines.push(`# Search eval: ${meta.label}`, "");
  lines.push(`- Ran: ${meta.at} (${Math.round(meta.durationMs / 1000)} s)`);
  lines.push(`- Target: ${meta.target} (${meta.transport}); facts from: ${meta.factsFrom ?? "none"}`);
  lines.push(`- Code: ${meta.git ?? "unknown"}; suites: ${meta.suites.join(", ")}${meta.sample ? `; sample ${meta.sample} per suite` : ""}`);
  lines.push(`- Requests: ${s.requests}; errors ${pct(s.error_rate)}; degraded (timed out, answered another way) ${pct(s.degraded_rate)}`);
  lines.push("");
  lines.push("## Scorecard", "", "| Metric | Value | Target | Baseline | |", "|---|---|---|---|---|");
  for (const g of guards) {
    const target = g.rule.min !== undefined ? `≥ ${fmt(g.key, g.rule.min)}` : `≤ ${fmt(g.key, g.rule.max)}`;
    const mark = g.value === null ? "no data" : g.pass ? (g.regressed ? "regressed" : "pass") : "FAIL";
    lines.push(`| ${g.key} | ${fmt(g.key, g.value)} | ${target} | ${fmt(g.key, g.baseline)} | ${mark} |`);
  }
  lines.push("");

  const t = s.topical;
  lines.push("## Relevance by cause (topic match@10, industry cases)", "");
  lines.push("| Cause | | Topic match@10 |", "|---|---|---|");
  for (const [c, v] of Object.entries(t.by_cause_topic_at10)) lines.push(`| ${c} | ${causes[c]?.label ?? ""} | ${pct(v)} |`);
  lines.push("");

  const worst = [...d.perCase].sort((a, b) => a.topic - b.topic || a.funder - b.funder).slice(0, 12);
  lines.push("## Weakest topical cases", "", "| Case | Query | Ran | Funders@10 | Topic@10 | Geo@10 | Top 3 |", "|---|---|---|---|---|---|---|");
  for (const c of worst) lines.push(`| ${c.key} | ${c.query.slice(0, 60)} | ${c.ran} | ${pct(c.funder)} | ${pct(c.topic)} | ${c.geo === null ? "" : pct(c.geo)} | ${c.top3.join("; ").replace(/\|/g, "/")} |`);
  lines.push("");

  if (s.navigational.cases) {
    lines.push("## Navigational", "", `Named funder in the top 3: ${pct(s.navigational.at3)} of ${s.navigational.cases}.`);
    if (s.navigational.misses.length) lines.push(`Missed: ${s.navigational.misses.join("; ")}.`);
    lines.push("");
  }

  const p = s.personalization;
  if (p.pairs) {
    lines.push("## Personalization (the same words, with and without the organization's profile)", "");
    lines.push("| Measure | With profile | Without | Lift |", "|---|---|---|---|");
    lines.push(`| Shared query: funders that gave in the org's state | ${pct(p.shared_geo_ctx)} | ${pct(p.shared_geo_none)} | ${fmt("lift", diff(p.shared_geo_ctx, p.shared_geo_none))} |`);
    lines.push(`| Shared query: funders of the org's cause | ${pct(p.shared_cause_ctx)} | ${pct(p.shared_cause_none)} | ${fmt("lift", diff(p.shared_cause_ctx, p.shared_cause_none))} |`);
    lines.push(`| Mission query: gave in the org's state | ${pct(p.mission_geo_ctx)} | ${pct(p.mission_geo_none)} | ${fmt("lift", diff(p.mission_geo_ctx, p.mission_geo_none))} |`);
    lines.push(`| Mission query: funders of the org's cause | ${pct(p.mission_cause_ctx)} | ${pct(p.mission_cause_none)} | ${fmt("lift", diff(p.mission_cause_ctx, p.mission_cause_none))} |`);
    lines.push("");
    lines.push(`- Lift, both queries together: geo ${fmt("lift", p.geo_lift)}, cause ${fmt("lift", p.cause_lift)}. Reported, not guarded: a lift also falls when the results without a profile get better, so the guards are the shares with a profile and the twin Jaccards.`);
    lines.push(`- Twins, Jaccard@20 of the top 20 for the same shared query (lower = the profile changed more): state ${fmt("jaccard", p.twin_jaccard_state)}, cause ${fmt("jaccard", p.twin_jaccard_cause)}, budget ${fmt("jaccard", p.twin_jaccard_budget)}.`);
    lines.push(`- Mean pairwise Jaccard@20 across all profiles on the shared queries: ${fmt("jaccard", p.shared_mean_pairwise_jaccard)} (1.00 = everyone saw the same list).`);
    lines.push(`- Typical grant size fits the budget (mission query, with profile): ${pct(p.size_fit_ctx)}. Profiles with ≥ 10 results: ${pct(p.profile_coverage)}.`);
    lines.push("");
  }

  lines.push("## Latency by mode", "", "| Mode | n | Client p50 | Client p95 | Server p50 | Server p95 |", "|---|---|---|---|---|---|");
  for (const [m, v] of Object.entries(s.latency.by_mode)) lines.push(`| ${m} | ${v.n} | ${num(v.client_p50)} | ${num(v.client_p95)} | ${num(v.server_p50)} | ${num(v.server_p95)} |`);
  lines.push("", "Client times include the network and, for previews, `vercel curl` start-up; server times come from the response's `timing`.", "");

  if (d.failures.length) {
    lines.push("## Failures", "");
    for (const f of d.failures.slice(0, 30)) lines.push(`- ${f.key}: ${f.status} ${f.error ?? ""} (${(f.query ?? "").slice(0, 60)})`);
    lines.push("");
  }
  if (d.degraded.length) {
    lines.push("## Degraded answers", "");
    for (const f of d.degraded.slice(0, 30)) lines.push(`- ${f.key}: ${f.notices.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

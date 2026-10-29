/**
 * The scorecard. Every relevance number is computed from the funders' own
 * grant records (lib/facts.mjs), never from what the search said about them.
 *
 *   funder rate@10   share of the top 10 that has paid grants on file (or
 *                    reported distributions): is it a funder at all?
 *   topic match@10   share of the top 10 with >= 2 grants on the case's topic,
 *                    or >= 3 grants to organizations in the case's cause,
 *                    in the last five fiscal years
 *   geo match@10     share of the top 10 that paid >= 1 grant to a recipient
 *                    in the case's state in the last five fiscal years
 *   recency@10       share of the top 10 whose latest grant is within 3 years
 *                    of the corpus's latest fiscal year
 *
 * @10 divides by 10, so a short list scores lower: an empty slot is not a fit.
 */

const TOPICAL_SUITES = new Set(["industries", "robustness"]);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export function quantile(xs, q) {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(v[lo] + (v[hi] - v[lo]) * (pos - lo));
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Judges a single hit against a lens, from the cached facts. */
export function judge(cache, maxFy) {
  const f = (id) => cache.funder(id);
  return {
    hasFacts: (hit) => f(hit.orgId) !== null,
    isFunder: (hit) => (f(hit.orgId)?.grantsAll ?? 0) > 0 || Number(hit.distributions ?? 0) > 0,
    topicMatch: (hit, cause, topic) =>
      (topic ? (cache.topic(hit.orgId, topic) ?? 0) >= 2 : false) || (cause ? (f(hit.orgId)?.byCause5y?.[cause] ?? 0) >= 3 : false),
    geoMatch: (hit, state) => (f(hit.orgId)?.byState5y?.[state] ?? 0) >= 1,
    recent: (hit) => (f(hit.orgId)?.lastFy ?? 0) >= maxFy - 3,
    sizeFit: (hit, budget) => {
      const m = f(hit.orgId)?.median5y;
      return typeof m === "number" && m >= 0.002 * budget && m <= 0.25 * budget;
    },
  };
}

const at10 = (hits, pred) => hits.slice(0, 10).filter(pred).length / 10;

export function computeMetrics(lists, cache, { maxFy, determinism = [] }) {
  const j = judge(cache, maxFy);
  const ok = lists.filter((l) => l.status === 200 && l.json && Array.isArray(l.json.hits));
  const failed = lists.filter((l) => !(l.status === 200 && l.json && Array.isArray(l.json.hits)));
  const degraded = ok.filter((l) => (l.json.notices ?? []).some((n) => n === "timed_out" || n === "semantic_timed_out"));
  const hitsOf = (l) => l.json?.hits ?? [];

  // Latency, by the mode the server actually ran.
  const serverMs = (l) => l.json?.timing?.totalMs ?? null;
  const byRan = {};
  for (const l of ok) {
    const ran = l.json.ran ?? "none";
    (byRan[ran] ??= { client: [], server: [] }).client.push(l.ms);
    if (serverMs(l) !== null) byRan[ran].server.push(serverMs(l));
  }
  const topicModes = ["semantic", "keyword"];
  const nameModes = ["name", "ein"];
  const pool = (modes, k) => modes.flatMap((m) => byRan[m]?.[k] ?? []);
  const latency = {
    client_p50_ms: quantile(ok.map((l) => l.ms), 0.5),
    client_p95_ms: quantile(ok.map((l) => l.ms), 0.95),
    server_p50_topic_ms: quantile(pool(topicModes, "server"), 0.5),
    server_p95_topic_ms: quantile(pool(topicModes, "server"), 0.95),
    server_p95_name_ms: quantile(pool(nameModes, "server"), 0.95),
    client_p95_topic_ms: quantile(pool(topicModes, "client"), 0.95),
    client_p95_name_ms: quantile(pool(nameModes, "client"), 0.95),
    by_mode: Object.fromEntries(
      Object.entries(byRan).map(([m, v]) => [m, { n: v.client.length, client_p50: quantile(v.client, 0.5), client_p95: quantile(v.client, 0.95), server_p50: quantile(v.server, 0.5), server_p95: quantile(v.server, 0.95) }]),
    ),
  };

  // Topical relevance across causes (industries and messy phrasings).
  const topical = ok.filter((l) => TOPICAL_SUITES.has(l.suite));
  const perCase = topical.map((l) => {
    const hits = hitsOf(l);
    return {
      key: l.key,
      suite: l.suite,
      cause: l.cause,
      state: l.state ?? null,
      query: l.query,
      ran: l.json.ran,
      n: hits.length,
      funder: at10(hits, j.isFunder),
      topic: at10(hits, (h) => j.topicMatch(h, l.cause, l.topic)),
      geo: l.state ? at10(hits, (h) => j.geoMatch(h, l.state)) : null,
      recent: at10(hits, j.recent),
      missingFacts: hits.slice(0, 10).filter((h) => !j.hasFacts(h)).length,
      top3: hits.slice(0, 3).map((h) => `${h.name} (${h.orgType}, ${h.state ?? "?"})`),
    };
  });
  const byCause = {};
  for (const c of perCase.filter((c) => c.suite === "industries")) (byCause[c.cause] ??= []).push(c.topic);
  const topicalSummary = {
    cases: perCase.length,
    funder_rate_at10: round(mean(perCase.map((c) => c.funder))),
    topic_match_at10: round(mean(perCase.map((c) => c.topic))),
    geo_match_at10: round(mean(perCase.filter((c) => c.geo !== null).map((c) => c.geo))),
    recency_at10: round(mean(perCase.map((c) => c.recent))),
    coverage: round(mean(perCase.map((c) => (c.n >= 10 ? 1 : 0)))),
    by_cause_topic_at10: Object.fromEntries(Object.entries(byCause).sort().map(([k, v]) => [k, round(mean(v), 2)])),
  };

  // Navigational: the named funder in the top 3.
  const nav = ok.filter((l) => l.suite === "navigational");
  const navCases = nav.map((l) => ({ key: l.key, query: l.query, hit: hitsOf(l).slice(0, 3).some((h) => (h.ein ?? "").replace(/\D/g, "") === l.ein) }));
  const navigational = { cases: navCases.length, at3: round(mean(navCases.map((c) => (c.hit ? 1 : 0)))), misses: navCases.filter((c) => !c.hit).map((c) => c.query) };

  // Personalization: the same words, with and without the profile attached.
  const prof = ok.filter((l) => l.suite === "personalization");
  const none = new Map(prof.filter((l) => l.variant === "none").map((l) => [l.noneKey, l]));
  const pairs = prof
    .filter((l) => l.variant === "ctx")
    .map((l) => ({ ctx: l, none: none.get(l.noneKey) }))
    .filter((p) => p.none);
  const lens = (p, which) => {
    const hits = hitsOf(p[which]);
    const pr = p.ctx.profile;
    return {
      geo: at10(hits, (h) => j.geoMatch(h, pr.state)),
      cause: at10(hits, (h) => j.topicMatch(h, pr.cause, p.ctx.topic)),
      size: at10(hits, (h) => j.sizeFit(h, pr.budget)),
    };
  };
  const scored = pairs.map((p) => ({ kind: p.ctx.queryKind, profile: p.ctx.profile, ctx: lens(p, "ctx"), none: lens(p, "none"), n: hitsOf(p.ctx).length }));
  const pick = (kind, which, k) => round(mean(scored.filter((s) => s.kind === kind).map((s) => s[which][k])));
  const twinJ = (kind) => {
    const groups = new Map();
    for (const l of prof.filter((l) => l.variant === "ctx" && l.queryKind === "shared" && l.profile.twin?.kind === kind)) {
      const g = `${l.profile.twin.group}|${l.query}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(hitsOf(l).slice(0, 20).map((h) => h.orgId));
    }
    return round(mean([...groups.values()].filter((v) => v.length === 2).map(([a, b]) => jaccard(a, b))));
  };
  const allShared = prof.filter((l) => l.variant === "ctx" && l.queryKind === "shared");
  const sharedSets = new Map();
  for (const l of allShared) {
    if (!sharedSets.has(l.query)) sharedSets.set(l.query, []);
    sharedSets.get(l.query).push(hitsOf(l).slice(0, 20).map((h) => h.orgId));
  }
  const crossJ = [];
  for (const sets of sharedSets.values()) for (let a = 0; a < sets.length; a++) for (let b = a + 1; b < sets.length; b++) crossJ.push(jaccard(sets[a], sets[b]));
  const personalization = {
    pairs: scored.length,
    shared_geo_ctx: pick("shared", "ctx", "geo"),
    shared_geo_none: pick("shared", "none", "geo"),
    shared_cause_ctx: pick("shared", "ctx", "cause"),
    shared_cause_none: pick("shared", "none", "cause"),
    mission_geo_ctx: pick("mission", "ctx", "geo"),
    mission_geo_none: pick("mission", "none", "geo"),
    mission_cause_ctx: pick("mission", "ctx", "cause"),
    mission_cause_none: pick("mission", "none", "cause"),
    size_fit_ctx: pick("mission", "ctx", "size"),
    twin_jaccard_state: twinJ("state"),
    twin_jaccard_cause: twinJ("cause"),
    twin_jaccard_budget: twinJ("budget"),
    shared_mean_pairwise_jaccard: round(mean(crossJ)),
    profile_coverage: round(mean(scored.map((s) => (s.n >= 10 ? 1 : 0)))),
  };
  const both = (a, b) => mean([a, b].filter((x) => x !== null));
  const lift = (a, b) => (a === null || b === null ? null : round(a - b));
  const geoCtx = both(personalization.shared_geo_ctx, personalization.mission_geo_ctx);
  const causeCtx = both(personalization.shared_cause_ctx, personalization.mission_cause_ctx);
  // Guarded: the share of the top 10 that fits the profile, with the profile
  // attached (shared and mission queries together).
  personalization.geo_with_profile = round(geoCtx);
  personalization.cause_with_profile = round(causeCtx);
  // Reported, not guarded: the gain over the same words without the profile.
  // A lift also falls when the results without a profile get better.
  personalization.geo_lift = lift(geoCtx, both(personalization.shared_geo_none, personalization.mission_geo_none));
  personalization.cause_lift = lift(causeCtx, both(personalization.shared_cause_none, personalization.mission_cause_none));

  const determinismRate = determinism.length ? round(mean(determinism.map((d) => (JSON.stringify(d.first) === JSON.stringify(d.second) ? 1 : 0)))) : null;

  return {
    summary: {
      requests: lists.length,
      error_rate: round(failed.length / Math.max(1, lists.length)),
      degraded_rate: round(degraded.length / Math.max(1, ok.length)),
      latency,
      topical: topicalSummary,
      navigational,
      personalization,
      determinism: determinismRate,
    },
    details: {
      failures: failed.map((l) => ({ key: l.key, status: l.status, error: l.error, query: l.query })),
      degraded: degraded.map((l) => ({ key: l.key, notices: l.json.notices })),
      perCase,
      scored: scored.map((s) => ({ profile: s.profile.id, kind: s.kind, ctx: s.ctx, none: s.none, n: s.n })),
    },
  };
}

/** Flatten nested summary keys ("topical.topic_match_at10") for guards and diffs. */
export function flat(summary, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(summary)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
    else if (typeof v === "number" || v === null) out[key] = v;
  }
  return out;
}

/** Guards from thresholds.json, plus regressions against a baseline summary. */
export function checkGuards(summary, thresholds, baseline) {
  const now = flat(summary);
  const base = baseline ? flat(baseline) : {};
  const rows = [];
  for (const [key, rule] of Object.entries(thresholds.guards)) {
    const v = now[key];
    let pass = v !== null && v !== undefined;
    if (pass && rule.min !== undefined) pass = v >= rule.min;
    if (pass && rule.max !== undefined) pass = v <= rule.max;
    const b = base[key];
    let regressed = false;
    if (typeof v === "number" && typeof b === "number") {
      const isLatency = key.includes("_ms");
      const tol = isLatency ? Math.abs(b) * thresholds.tolerance.latency_pct : thresholds.tolerance.rate;
      regressed = rule.max !== undefined ? v > b + tol : v < b - tol;
    }
    rows.push({ key, value: v ?? null, rule, pass, baseline: b ?? null, regressed });
  }
  return rows;
}

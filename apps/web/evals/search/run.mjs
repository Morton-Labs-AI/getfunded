#!/usr/bin/env node
/**
 * The search eval suite: is funder search fast, accurate, useful across every
 * kind of nonprofit, and does it change for the organization searching?
 * README.md explains the measures; IMPROVE.md is the loop agents follow.
 *
 *   npm run eval:search -- --target <url|prod|local> [options]
 *
 *   --target       deployment to search (prod = https://getfunded.ai)
 *   --facts-from   deployment that answers /api/eval/facts (default: target)
 *   --suite        all | industries | navigational | robustness | personalization (comma list)
 *   --sample N     at most N cases per suite (and N profiles), chosen by seed
 *   --concurrency  requests in flight (default 6; 1 with no eval token)
 *   --rpm          client-side rate limit (default 25/min with no eval token)
 *   --label        name for the run (default: the target host)
 *   --save-report  also write reports/<date>-<label>.{md,json} (commit milestone runs)
 *   --update-baseline   make this run the baseline later runs are compared to
 *   --no-fail      exit 0 even when a guard fails
 *
 * The eval token (EVAL_TOKEN in the environment, or in apps/web/.env.development.local)
 * lifts the rate limit and unlocks the facts endpoint on a deployment created
 * with the same token. Without facts, relevance measures read n/a.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProfiles, SHARED_QUERIES } from "./cases/profiles.mjs";
import { ensureFacts, openFactsCache } from "./lib/facts.mjs";
import { chooseTransport, makeClient, pool } from "./lib/http.mjs";
import { checkGuards, computeMetrics } from "./lib/metrics.mjs";
import { renderReport } from "./lib/report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..", "..");
const readJson = (p) => JSON.parse(readFileSync(path.join(here, p), "utf8"));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const ALIASES = { prod: "https://getfunded.ai", production: "https://getfunded.ai", local: "http://localhost:3050" };

function evalToken() {
  if (process.env.EVAL_TOKEN?.trim()) return process.env.EVAL_TOKEN.trim();
  const file = path.join(webDir, ".env.development.local");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("EVAL_TOKEN="));
  return line ? line.slice("EVAL_TOKEN=".length).trim() || null : null;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(items, n, rand) {
  if (!n || items.length <= n) return items;
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [copy[i], copy[k]] = [copy[k], copy[i]];
  }
  return copy.slice(0, n);
}

/** The searches a run makes. Each becomes one GET /api/search. */
function buildLists(suites, n, causes) {
  const rand = seeded(7);
  const lists = [];
  const topical = (suite, file) => {
    for (const c of sample(readJson(file).cases, n, rand)) {
      lists.push({ key: `${suite}:${c.id}`, suite, query: c.query, cause: c.cause, state: c.state ?? null, topic: c.topic ?? causes[c.cause].topic, params: { q: c.query } });
    }
  };
  if (suites.has("industries")) topical("industries", "cases/industries.json");
  if (suites.has("robustness")) topical("robustness", "cases/robustness.json");
  if (suites.has("navigational")) {
    for (const c of sample(readJson("cases/navigational.json").cases, n, rand)) lists.push({ key: `navigational:${c.id}`, suite: "navigational", query: c.query, ein: c.ein, params: { q: c.query } });
  }
  if (suites.has("personalization")) {
    const profiles = buildProfiles();
    const keep = n ? new Set(sample(profiles.filter((p) => !p.twin), Math.max(0, n - 10), rand).map((p) => p.id)) : null;
    // With a sample, keep whole twin pairs (the first five of each kind) so twins still compare.
    const chosen = profiles.filter((p) => !keep || keep.has(p.id) || (p.twin && Number(p.twin.group.split("-")[1]) < Math.ceil(n / 6)));
    const none = new Map();
    for (const p of chosen) {
      const ctx = { for_state: p.state, for_cause: p.cause, for_budget: String(p.budget), for_city: p.city };
      const queries = [...SHARED_QUERIES.map((q) => ({ q, kind: "shared" })), { q: p.mission, kind: "mission" }];
      queries.forEach(({ q, kind }, i) => {
        const noneKey = `${kind}|${q}`;
        lists.push({ key: `personalization:${p.id}:${kind}:${i}`, suite: "personalization", variant: "ctx", queryKind: kind, query: q, profile: p, topic: causes[p.cause].topic, noneKey, params: { q, ...ctx } });
        if (!none.has(noneKey)) {
          none.set(noneKey, true);
          lists.push({ key: `personalization:none:${noneKey}`, suite: "personalization", variant: "none", queryKind: kind, query: q, noneKey, params: { q } });
        }
      });
    }
  }
  return lists;
}

function compactHit(h) {
  return {
    orgId: h.orgId,
    name: h.name,
    orgType: h.orgType,
    state: h.state,
    ein: h.ein,
    grantsOnFile: h.grantsOnFile,
    distributions: h.distributions,
    posture: h.posture,
    kind: h.match?.kind ?? null,
    ...(h.fit ? { fit: h.fit } : {}),
  };
}

function gitDescribe() {
  try {
    return execFileSync("git", ["-C", webDir, "log", "-1", "--format=%h %s"], { encoding: "utf8" }).trim().slice(0, 100);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    console.error("usage: npm run eval:search -- --target <url|prod|local> [--facts-from <url>] [--suite ...] [--sample N]");
    process.exit(2);
  }
  const target = ALIASES[args.target] ?? args.target;
  const factsFrom = args["facts-from"] ? (ALIASES[args["facts-from"]] ?? args["facts-from"]) : target;
  const suites = new Set(String(args.suite ?? "all") === "all" ? ["industries", "navigational", "robustness", "personalization"] : String(args.suite).split(","));
  const n = args.sample ? Number(args.sample) : null;
  const token = evalToken();
  const transport = chooseTransport(target, args.transport);
  const tokenOnTarget = Boolean(token) && !/getfunded\.ai$/i.test(new URL(target).host);
  const concurrency = Number(args.concurrency ?? (tokenOnTarget ? 6 : 1));
  const rpm = args.rpm ? Number(args.rpm) : tokenOnTarget ? 0 : 25;
  const label = String(args.label ?? new URL(target).host.split(".")[0]);
  const { causes } = readJson("cases/causes.json");
  const thresholds = readJson("thresholds.json");
  const baselinePath = path.join(here, "baseline.json");
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")).summary : null;
  const log = (m) => console.error(`[eval] ${m}`);

  const lists = buildLists(suites, n, causes);
  log(`${lists.length} searches against ${target} (${transport}${tokenOnTarget ? ", eval token" : `, ${rpm}/min`}), concurrency ${concurrency}`);
  const started = Date.now();
  const get = makeClient({ base: target, transport, token: tokenOnTarget ? token : null, cwd: webDir, perMinute: rpm });
  let done = 0;
  await pool(lists, concurrency, async (l) => {
    const r = await get(`/api/search?${new URLSearchParams(l.params)}`);
    l.status = r.status;
    l.ms = r.ms;
    l.error = r.error ?? (r.json?.error?.message ?? null);
    l.json = r.status === 200 && r.json?.hits ? { ran: r.json.ran, total: r.json.total, notices: r.json.notices ?? [], timing: r.json.timing ?? null, context: r.json.context ?? null, hits: r.json.hits.slice(0, 20).map(compactHit) } : null;
    if (++done % 25 === 0) log(`${done}/${lists.length} searches`);
  });

  // Determinism: the same request twice must give the same top 20.
  const rand = seeded(11);
  const again = sample(lists.filter((l) => l.json), 8, rand);
  const determinism = await pool(again, Math.min(concurrency, 4), async (l) => {
    const r = await get(`/api/search?${new URLSearchParams(l.params)}`);
    return { key: l.key, first: l.json.hits.map((h) => h.orgId), second: (r.json?.hits ?? []).slice(0, 20).map((h) => h.orgId) };
  });

  // Ground truth for every funder that reached a top 10.
  const cache = openFactsCache(path.join(here, ".cache"));
  const factsToken = token && !/getfunded\.ai$/i.test(new URL(factsFrom).host) ? token : null;
  let factsStatus = "skipped (no eval token for the facts deployment)";
  if (factsToken) {
    const wants = [];
    const profilesByNone = new Map();
    for (const l of lists.filter((l) => l.variant === "ctx")) {
      if (!profilesByNone.has(l.noneKey)) profilesByNone.set(l.noneKey, new Set());
      profilesByNone.get(l.noneKey).add(l.topic);
    }
    for (const l of lists.filter((l) => l.json)) {
      const ids = l.json.hits.slice(0, 10).map((h) => h.orgId);
      const topics = l.variant === "none" ? [...(profilesByNone.get(l.noneKey) ?? [])] : [l.topic ?? null];
      for (const id of ids) for (const topic of topics) wants.push({ id, topic });
    }
    const factsGet = makeClient({ base: factsFrom, transport: chooseTransport(factsFrom, args["facts-transport"]), token: factsToken, cwd: webDir, perMinute: 0, timeoutSec: 120 });
    const r = await ensureFacts(wants, cache, factsGet, { concurrency: 3, log });
    factsStatus = `${r.fetched} requests fetched, ${r.failed} failed`;
  }
  const maxFy = cache.data.maxFy ?? new Date().getUTCFullYear() - 1;

  const metrics = computeMetrics(lists, cache, { maxFy, determinism });
  const guards = checkGuards(metrics.summary, thresholds, baseline);
  const meta = {
    label,
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    target,
    transport,
    factsFrom: factsToken ? factsFrom : null,
    factsStatus,
    maxFy,
    git: gitDescribe(),
    suites: [...suites],
    sample: n,
  };
  const md = renderReport({ meta, metrics, guards, causes });

  const stamp = meta.at.replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(here, "out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${stamp}-${label}.json`), JSON.stringify({ meta, summary: metrics.summary, details: metrics.details, lists: lists.map(({ profile, ...l }) => ({ ...l, profile: profile?.id })) }));
  writeFileSync(path.join(outDir, `${stamp}-${label}.md`), md);
  if (args["save-report"]) {
    const reportsDir = path.join(here, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const base = `${meta.at.slice(0, 10)}-${label}`;
    writeFileSync(path.join(reportsDir, `${base}.md`), md);
    writeFileSync(path.join(reportsDir, `${base}.json`), JSON.stringify({ meta, summary: metrics.summary }, null, 2));
    log(`report saved: evals/search/reports/${base}.md`);
  }
  if (args["update-baseline"]) {
    writeFileSync(baselinePath, JSON.stringify({ label, at: meta.at, target, git: meta.git, summary: metrics.summary }, null, 2) + "\n");
    log("baseline updated");
  }
  console.log(md);
  log(`facts: ${factsStatus}; full run written to evals/search/out/${stamp}-${label}.json`);
  const failing = guards.filter((g) => !g.pass || g.regressed);
  if (failing.length && !args["no-fail"]) {
    log(`${failing.length} guard(s) failed or regressed: ${failing.map((g) => g.key).join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

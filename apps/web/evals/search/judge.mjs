#!/usr/bin/env node
/**
 * Judged relevance labels for the search eval (IMPROVE.md, "Growing the
 * golden labels"). The data-derived measures say whether a funder gives in a
 * state or to a cause; a judge says whether it is a good lead for THIS
 * nonprofit. Labels accumulate in labels/golden/*.jsonl, so each run only
 * needs the pairs nobody has judged yet.
 *
 *   node evals/search/judge.mjs packets --run <out json> [--evidence-from <url>] [--limit N] [--cases <regex on list keys>]
 *       writes evals/search/out/packets-<stamp>.jsonl: one unlabeled (case, funder) pair per line,
 *       with what the searcher asked and the funder's evidence from its own filings
 *   node evals/search/judge.mjs score --run <out json>
 *       P@10 and nDCG@10 over the judged pairs of that run
 *
 * A label line: {"case": "<list key>", "orgId": "<uuid>", "label": 0|1|2, "why": "...", "judgedBy": "...", "at": "YYYY-MM-DD"}
 *   2 a strong lead: it has funded this kind of work for this kind of place recently
 *   1 plausible: related giving, or the right place but adjacent work
 *   0 not a fit
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProfiles } from "./cases/profiles.mjs";
import { openFactsCache } from "./lib/facts.mjs";
import { chooseTransport, makeClient, pool } from "./lib/http.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..", "..");
const labelsDir = path.join(here, "labels", "golden");
const { causes } = JSON.parse(readFileSync(path.join(here, "cases", "causes.json"), "utf8"));

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) out._.push(a);
    else if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

function evalToken() {
  if (process.env.EVAL_TOKEN?.trim()) return process.env.EVAL_TOKEN.trim();
  const file = path.join(webDir, ".env.development.local");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("EVAL_TOKEN="));
  return line ? line.slice("EVAL_TOKEN=".length).trim() || null : null;
}

export function safeName(key) {
  return key.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function readLabels() {
  const labels = new Map();
  if (!existsSync(labelsDir)) return labels;
  for (const f of readdirSync(labelsDir).filter((f) => f.endsWith(".jsonl"))) {
    for (const line of readFileSync(path.join(labelsDir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const l = JSON.parse(line);
        if (typeof l.case === "string" && typeof l.orgId === "string" && [0, 1, 2].includes(l.label)) labels.set(`${l.case}|${l.orgId}`, l.label);
      } catch {
        /* a broken line is skipped, not fatal */
      }
    }
  }
  return labels;
}

/** The lists a judge can grade: topical cases and profile searches with their profile. */
function judgeable(run) {
  return run.lists.filter((l) => l.json?.hits && (l.suite === "industries" || l.suite === "robustness" || (l.suite === "personalization" && l.variant === "ctx")));
}

function requestOf(list, profiles) {
  const p = list.profile ? profiles.get(list.profile) : null;
  return {
    query: list.query,
    ...(list.cause ? { cause: causes[list.cause]?.label ?? list.cause } : {}),
    ...(list.state ? { state: list.state } : {}),
    ...(p ? { nonprofit: { mission: p.mission, city: p.city, state: p.state, cause: causes[p.cause]?.label ?? p.cause, budget: p.budget } } : {}),
  };
}

async function packets(a) {
  const run = JSON.parse(readFileSync(a.run, "utf8"));
  const limit = Number(a.limit ?? 40);
  const labels = readLabels();
  const profiles = new Map(buildProfiles().map((p) => [p.id, p]));
  const want = [];
  const only = a.cases ? new RegExp(String(a.cases)) : null;
  for (const list of judgeable(run).filter((l) => !only || only.test(l.key))) {
    for (const hit of list.json.hits.slice(0, 10)) {
      if (!labels.has(`${list.key}|${hit.orgId}`)) want.push({ list, hit });
      if (want.length >= limit) break;
    }
    if (want.length >= limit) break;
  }
  if (want.length === 0) {
    console.log("Every top-10 pair of this run is already judged.");
    return;
  }
  const base = a["evidence-from"] ?? run.meta.target;
  const token = evalToken();
  const get = makeClient({ base, transport: chooseTransport(base), token, cwd: webDir, perMinute: 0, timeoutSec: 120 });
  const ids = [...new Set(want.map((w) => w.hit.orgId))];
  const evidence = {};
  const batches = [];
  for (let i = 0; i < ids.length; i += 12) batches.push(ids.slice(i, i + 12));
  await pool(batches, 3, async (batch) => {
    const r = await get(`/api/eval/evidence?ids=${batch.join(",")}`);
    if (r.status === 200 && r.json?.funders) Object.assign(evidence, r.json.funders);
    else console.error(`[judge] evidence failed: ${r.status} ${r.error ?? ""}`);
  });
  const cache = openFactsCache(path.join(here, ".cache"));
  const top = (obj, n) =>
    Object.entries(obj ?? {})
      .sort((x, y) => y[1] - x[1])
      .slice(0, n);
  const lines = want.map(({ list, hit }) => {
    const f = cache.funder(hit.orgId);
    const ev = evidence[hit.orgId] ?? { purposes: [], recipients: [] };
    return JSON.stringify({
      case: list.key,
      orgId: hit.orgId,
      request: requestOf(list, profiles),
      funder: {
        name: hit.name,
        type: hit.orgType,
        state: hit.state,
        posture: hit.posture ?? "not stated",
        grantsLast5y: f?.grants5y ?? null,
        medianGrant: f?.median5y ?? null,
        latestGrantFy: f?.lastFy ?? null,
        topRecipientStates: top(f?.byState5y, 5).map(([k, v]) => `${k} (${v})`),
        topRecipientCauses: top(f?.byCause5y, 5).map(([k, v]) => `${causes[k]?.label ?? k} (${v})`),
        frequentPurposes: ev.purposes.map((p) => `${p.purpose} (x${p.n})`),
        largestRecipients: ev.recipients.map((r) => `${r.name}${r.state ? `, ${r.state}` : ""}${r.total ? ` ($${r.total.toLocaleString("en-US")})` : ""}`),
      },
    });
  });
  mkdirSync(path.join(here, "out"), { recursive: true });
  const file = path.join(here, "out", `packets-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.jsonl`);
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`${lines.length} packets written to ${path.relative(process.cwd(), file)}`);
}

function score(a) {
  const run = JSON.parse(readFileSync(a.run, "utf8"));
  const labels = readLabels();
  let scored = 0;
  let pairs = 0;
  let judged = 0;
  const p10 = [];
  const ndcg = [];
  for (const list of judgeable(run)) {
    const top = list.json.hits.slice(0, 10);
    const gains = top.map((h) => labels.get(`${list.key}|${h.orgId}`));
    pairs += top.length;
    const known = gains.filter((g) => g !== undefined);
    judged += known.length;
    if (known.length < 5) continue; // too few judged to say anything about this list
    scored++;
    p10.push(known.filter((g) => g >= 1).length / known.length);
    const dcg = gains.reduce((s, g, i) => s + (g === undefined ? 0 : (2 ** g - 1) / Math.log2(i + 2)), 0);
    const ideal = [...known].sort((x, y) => y - x).reduce((s, g, i) => s + (2 ** g - 1) / Math.log2(i + 2), 0);
    ndcg.push(ideal > 0 ? dcg / ideal : 0);
  }
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000 : null);
  console.log(JSON.stringify({ listsScored: scored, judgedPairs: judged, pairsInTop10: pairs, coverage: pairs ? Math.round((judged / pairs) * 1000) / 1000 : 0, precisionAt10: mean(p10), ndcgAt10: mean(ndcg) }, null, 2));
}

const a = args(process.argv.slice(2));
const cmd = a._[0];
if (!a.run || !["packets", "score"].includes(cmd)) {
  console.error("usage: node evals/search/judge.mjs packets|score --run evals/search/out/<run>.json [--limit N] [--evidence-from <url>]");
  process.exit(2);
}
if (cmd === "packets") {
  packets(a).catch((err) => {
    console.error(err);
    process.exit(2);
  });
} else {
  score(a);
}

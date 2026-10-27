/**
 * Ground truth per funder from /api/eval/facts, cached on disk for a week
 * (the corpus refreshes daily at most, and a label changes far more slowly).
 * Cache key: org id for the lens-free facts, org id + topic for the topic count.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { pool } from "./http.mjs";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const BATCH = 12;

export function openFactsCache(dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "facts.json");
  let data = { maxFy: null, minFy: null, funders: {}, topics: {} };
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* start over */
    }
  }
  const fresh = (entry) => entry && Date.now() - entry.at < WEEK_MS;
  return {
    data,
    funder: (id) => (fresh(data.funders[id]) ? data.funders[id].facts : null),
    topic: (id, topic) => (fresh(data.topics[`${id}|${topic}`]) ? data.topics[`${id}|${topic}`].n : null),
    put(json, topic) {
      data.maxFy = json.maxFy;
      data.minFy = json.minFy;
      const at = Date.now();
      for (const [id, f] of Object.entries(json.funders)) {
        const { topic5y, ...rest } = f;
        data.funders[id] = { at, facts: rest };
        if (topic) data.topics[`${id}|${topic}`] = { at, n: topic5y ?? 0 };
      }
    },
    save: () => writeFileSync(file, JSON.stringify(data)),
  };
}

/**
 * Make sure facts exist for every (id, topic) pair in `wants`. `get` is a
 * client from http.mjs pointed at a deployment that answers /api/eval/facts.
 */
export async function ensureFacts(wants, cache, get, { concurrency = 3, log = () => {} } = {}) {
  const byTopic = new Map();
  for (const { id, topic } of wants) {
    const missing = cache.funder(id) === null || (topic && cache.topic(id, topic) === null);
    if (!missing) continue;
    const key = topic ?? "";
    if (!byTopic.has(key)) byTopic.set(key, new Set());
    byTopic.get(key).add(id);
  }
  const jobs = [];
  for (const [topic, ids] of byTopic) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += BATCH) jobs.push({ topic: topic || null, ids: list.slice(i, i + BATCH) });
  }
  if (jobs.length === 0) return { fetched: 0, failed: 0 };
  log(`facts: ${jobs.length} requests for ${wants.length} (funder, topic) pairs not in the cache`);
  let failed = 0;
  await pool(jobs, concurrency, async (job, k) => {
    // A batch holding one of the very largest funders can outrun the route's
    // timeout; split it and try the halves before giving up.
    const attempt = async (ids) => {
      const qs = new URLSearchParams({ ids: ids.join(",") });
      if (job.topic) qs.set("topic", job.topic);
      const r = await get(`/api/eval/facts?${qs}`);
      if (r.status === 200 && r.json?.funders) {
        cache.put(r.json, job.topic);
        return true;
      }
      if (ids.length > 1 && (r.status === 504 || r.status === 0)) {
        const mid = Math.ceil(ids.length / 2);
        const [a, b] = [await attempt(ids.slice(0, mid)), await attempt(ids.slice(mid))];
        return a && b;
      }
      log(`facts request ${k + 1}/${jobs.length} failed for ${ids.length} id(s): ${r.status} ${r.error ?? r.json?.error?.message ?? ""}`);
      return false;
    };
    if (!(await attempt(job.ids))) failed++;
    if ((k + 1) % 20 === 0) cache.save();
  });
  cache.save();
  return { fetched: jobs.length - failed, failed };
}

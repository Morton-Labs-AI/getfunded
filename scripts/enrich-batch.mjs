/**
 * Two-phase web-fact enrichment for a list of orgs.
 *
 *   node scripts/enrich-batch.mjs --fetch   --targets <file.json> [--out <dir>]
 *   node scripts/enrich-batch.mjs --review  --run <dir>
 *   node scripts/enrich-batch.mjs --confirm --run <dir> --approved <file>
 *
 * WHY TWO PHASES. migrations/0012 is built around a human deciding: rows exist
 * in internal.org_web_facts ONLY after someone looked at the extraction. The
 * containment benchmark (B11) and the whole non-republishable licensing story
 * rest on that. A one-shot batch that fetched and confirmed in the same breath
 * would quietly convert a human gate into a machine one, so this does not do
 * that.
 *
 *   --fetch    crawls and extracts, writing internal.raw_files and a snapshot
 *              only. Explicitly harmless and append-only. NOTHING enters
 *              org_web_facts. Produces previews.json.
 *   --review   renders previews.json as review.html — every field with its
 *              confidence and the verbatim snippet it came from.
 *   --confirm  writes ONLY the org_ids listed in the approved file.
 *
 * Because sameDaySnapshot() reuses today's crawl, --confirm re-fetches nothing;
 * the funder's website is hit once regardless of how long review takes.
 *
 * Requires the admin UI running on localhost with ADMIN_ENABLED=1 — the routes
 * are loopback-only by design (lib/admin/guard.ts), which is also why this is a
 * script talking to them rather than a second copy of the crawler.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const BASE = process.env.ADMIN_BASE_URL ?? "http://localhost:3010";
const RUN_DIR = val("--run", val("--out", `data/enrich-runs/${today()}`));
const PACE_MS = 2000; // on top of the crawler's own 1.1s inter-page delay

function today() {
  return new Date().toISOString().slice(0, 10);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------

if (has("--fetch")) await phaseFetch();
else if (has("--review")) phaseReview();
else if (has("--confirm")) await phaseConfirm();
else {
  console.error("Pass one of --fetch, --review, --confirm. See the header.");
  process.exit(1);
}

// ---------------------------------------------------------------------------

async function phaseFetch() {
  const targets = JSON.parse(readFileSync(val("--targets", ""), "utf8"));
  mkdirSync(RUN_DIR, { recursive: true });
  console.log(`fetching ${targets.length} orgs -> ${RUN_DIR}\n`);

  const previews = [];
  for (const [i, t] of targets.entries()) {
    const label = `${String(i + 1).padStart(3)}/${targets.length} ${t.org_name.slice(0, 44)}`;
    try {
      const res = await fetch(`${BASE}/api/admin/enrich/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: t.org_id, org_name: t.org_name, url: t.website }),
      });
      const body = await res.json();
      if (!res.ok) {
        console.log(`${label}  SKIP (${body.stage ?? res.status}: ${body.error ?? ""})`);
        previews.push({ ...t, error: body.error ?? `http ${res.status}`, stage: body.stage });
      } else {
        const n = Object.keys(body.extraction?.fields?.confidence ?? {}).length;
        console.log(`${label}  ok — ${body.page_count} pages, ${n} fields${body.reused ? " (reused today's snapshot)" : ""}`);
        previews.push({ ...t, ...body });
      }
    } catch (e) {
      console.log(`${label}  ERROR ${e.message}`);
      previews.push({ ...t, error: e.message });
    }
    if (i < targets.length - 1) await sleep(PACE_MS);
  }

  writeFileSync(join(RUN_DIR, "previews.json"), JSON.stringify(previews, null, 2));
  const ok = previews.filter((p) => !p.error).length;
  console.log(`\n${ok}/${previews.length} extracted. Nothing written to org_web_facts.`);
  console.log(`next: node scripts/enrich-batch.mjs --review --run ${RUN_DIR}`);
}

// ---------------------------------------------------------------------------

function phaseReview() {
  const previews = JSON.parse(readFileSync(join(RUN_DIR, "previews.json"), "utf8"));
  const ok = previews.filter((p) => !p.error);
  const failed = previews.filter((p) => p.error);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const FIELDS = [
    ["giving_priorities", "Giving priorities"],
    ["application_info", "How to apply"],
    ["application_url", "Application URL"],
    ["accepts_unsolicited", "Accepts unsolicited"],
    ["focus_areas", "Focus areas"],
    ["geographic_focus", "Geographic focus"],
    ["extracted_summary", "Summary"],
  ];

  const card = (p) => {
    const f = p.extraction.fields;
    const rows = FIELDS.map(([key, label]) => {
      let v = f[key];
      if (Array.isArray(v)) v = v.length ? v.join(", ") : null;
      if (v === null || v === undefined || v === "")
        return `<tr class="empty"><th>${label}</th><td colspan="2">the site does not say</td></tr>`;
      const conf = f.confidence?.[key];
      const snip = f.snippets?.[key];
      return `<tr>
        <th>${label}</th>
        <td>${esc(v)}${conf ? `<span class="conf">${Math.round(conf * 100)}%</span>` : ""}</td>
        <td class="snip">${snip ? `“${esc(snip.excerpt)}”<br><a href="${esc(snip.page)}">${esc(snip.page)}</a>` : ""}</td>
      </tr>`;
    }).join("");
    return `<section>
      <h2>${esc(p.org_name)} <span class="fit">fit ${p.fit_score ?? "—"}</span></h2>
      <p class="meta"><a href="${esc(p.final_url)}">${esc(p.final_url)}</a> · ${p.page_count} pages · ${esc(p.extraction.model)}
        · <code>${esc(p.org_id)}</code></p>
      <table>${rows}</table>
    </section>`;
  };

  const html = `<!doctype html><meta charset="utf-8"><title>Enrichment review — ${today()}</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;max-width:70rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
 h1{font-size:1.5rem} h2{font-size:1.05rem;margin:0 0 .2rem}
 section{border:1px solid #ddd;border-radius:8px;padding:1rem 1.2rem;margin:1rem 0}
 .meta{color:#666;font-size:12.5px;margin:.1rem 0 .7rem}
 .fit{font-weight:400;color:#666;font-size:12.5px}
 table{width:100%;border-collapse:collapse}
 th{text-align:left;width:9rem;vertical-align:top;font-weight:600;color:#444;padding:.35rem .6rem .35rem 0}
 td{vertical-align:top;padding:.35rem 0}
 td.snip{color:#666;font-size:12.5px;width:38%;padding-left:1rem;border-left:2px solid #eee}
 tr.empty td{color:#999;font-style:italic}
 .conf{color:#888;font-size:11.5px;margin-left:.5rem}
 .lead{background:#fffbe6;border:1px solid #f0e0a0;padding:.8rem 1rem;border-radius:8px}
 code{font-size:12px;color:#555}
</style>
<h1>Web-fact enrichment review — ${today()}</h1>
<p class="lead"><b>Nothing below has been written yet.</b> These are previews.
Put the org ids you approve into an <code>approved.json</code> array, then run
<code>node scripts/enrich-batch.mjs --confirm --run ${RUN_DIR} --approved ${RUN_DIR}/approved.json</code>.
Every value shows the verbatim snippet it came from — if a snippet does not
support the value, reject it.</p>
<p>${ok.length} extracted${failed.length ? `, ${failed.length} failed` : ""}.</p>
${ok.map(card).join("")}
${failed.length ? `<section><h2>Failed</h2><ul>${failed.map((p) => `<li>${esc(p.org_name)} — ${esc(p.stage ?? "")} ${esc(p.error)}</li>`).join("")}</ul></section>` : ""}`;

  const out = join(RUN_DIR, "review.html");
  writeFileSync(out, html);
  writeFileSync(
    join(RUN_DIR, "approved.example.json"),
    JSON.stringify(ok.map((p) => p.org_id), null, 2)
  );
  console.log(`wrote ${out}`);
  console.log(`a pre-filled all-approved list is at ${join(RUN_DIR, "approved.example.json")} — edit it down, do not just rename it`);
}

// ---------------------------------------------------------------------------

async function phaseConfirm() {
  const previews = JSON.parse(readFileSync(join(RUN_DIR, "previews.json"), "utf8"));
  const approvedPath = val("--approved", join(RUN_DIR, "approved.json"));
  if (!existsSync(approvedPath)) {
    console.error(`No approved list at ${approvedPath}. Run --review first and approve explicitly.`);
    process.exit(1);
  }
  const approved = new Set(JSON.parse(readFileSync(approvedPath, "utf8")));
  const reviewedBy = val("--reviewed-by", "human:zach (batch review)");

  const todo = previews.filter((p) => !p.error && approved.has(p.org_id));
  console.log(`confirming ${todo.length} of ${previews.length} previews as "${reviewedBy}"\n`);

  let ok = 0;
  for (const p of todo) {
    const res = await fetch(`${BASE}/api/admin/enrich/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org_id: p.org_id,
        raw_file_id: p.raw_file_id,
        final_url: p.final_url,
        model: p.extraction.model,
        fields: p.extraction.fields,
        reviewed_by: reviewedBy,
        notes: `Batch enrichment ${today()} for the DNW fit-evidence experiment.`,
      }),
    });
    const body = await res.json();
    if (res.ok) {
      ok++;
      console.log(`  ok   ${p.org_name}`);
    } else {
      console.log(`  FAIL ${p.org_name} — ${body.error ?? res.status}`);
    }
  }
  console.log(`\n${ok}/${todo.length} confirmed into internal.org_web_facts.`);
}

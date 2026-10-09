import { createHash } from "crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { adminSql } from "@/lib/admin/db";
import { htmlToText } from "@/lib/admin/html-text";

/**
 * Website-enrichment pipeline (dev-only; runs behind adminRoute).
 *
 * File-first provenance, mirroring staging.py's contract: fetch → one JSON
 * bundle per run (schema funder_website_snapshot/v1) → sha-first filename in
 * $FUNDERDB_RAW_DIR/funder_website/ → manifest line → raw_files registration
 * under dataset 'funder_website' / license 'publisher_website'
 * (republishable=false — snapshots and extracted facts never surface in
 * public.* views). Nothing here writes org_web_facts; the confirm route does
 * that only after human review.
 */

export class EnrichError extends Error {
  constructor(
    public stage: "robots" | "fetch" | "http_status" | "content_type" | "extract",
    message: string
  ) {
    super(message);
  }
}

// Same UA convention as staging.py — all repo traffic identifies identically.
const FETCH_UA = "Mozilla/5.0 (Macintosh) MortonLabs-funderdb (zach@mortonlabs.ai)";
const PAGE_CAP = 2 * 1024 * 1024;
const BUNDLE_CAP = 10 * 1024 * 1024;
const MAX_SUBPAGES = 5;
const LINK_RE =
  /(about|mission|grant|apply|application|guidelines|program|funding|team|staff|people|board|leadership|contact)/i;
export const EXTRACTION_MODEL = "claude-sonnet-5";

export interface BundlePage {
  requested_url: string;
  final_url: string;
  http_status: number;
  content_type: string;
  bytes: number;
  truncated: boolean;
  html: string;
}

export interface SnapshotBundle {
  schema: "funder_website_snapshot/v1";
  org_id: string;
  org_name: string;
  seed_url: string;
  fetched_at: string;
  triggered_by: string;
  robots: { url: string; fetched: boolean; allowed: boolean; matched_rule: string | null };
  pages: BundlePage[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reject non-http(s) and private/loopback hosts (dev-only, but no reason to
    allow SSRF shapes). Literal checks only — no DNS resolution. */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new EnrichError("fetch", `not a valid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new EnrichError("fetch", "only http/https URLs are supported");
  }
  const h = u.hostname.toLowerCase();
  const privateHost =
    h === "localhost" ||
    h.endsWith(".local") ||
    h === "::1" ||
    h === "[::1]" ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^0\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/i.test(h);
  if (privateHost) {
    throw new EnrichError("fetch", `refusing to fetch private/loopback host ${h}`);
  }
  return u;
}

async function checkRobots(seed: URL): Promise<SnapshotBundle["robots"]> {
  const robotsUrl = `${seed.origin}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, {
      headers: { "user-agent": FETCH_UA },
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (!res.ok) {
      // 4xx → no robots policy → allowed. 5xx → proceed, record unfetched.
      return { url: robotsUrl, fetched: res.status < 500, allowed: true, matched_rule: null };
    }
    const text = (await res.text()).slice(0, 100_000);
    // Minimal parse: refuse only on an explicit blanket `Disallow: /` in a
    // group applying to * or to our UA (the plan's politeness rule).
    let applies = false;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      const m = line.match(/^user-agent:\s*(.+)$/i);
      if (m) {
        const agent = m[1].trim().toLowerCase();
        applies = agent === "*" || agent.includes("mortonlabs");
        continue;
      }
      if (applies && /^disallow:\s*\/\s*$/i.test(line)) {
        return { url: robotsUrl, fetched: true, allowed: false, matched_rule: "Disallow: /" };
      }
    }
    return { url: robotsUrl, fetched: true, allowed: true, matched_rule: null };
  } catch {
    return { url: robotsUrl, fetched: false, allowed: true, matched_rule: null };
  }
}

async function fetchPage(url: string): Promise<BundlePage> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": FETCH_UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new EnrichError("fetch", `could not reach ${url}: ${msg}`);
  }
  if (!res.ok) {
    throw new EnrichError("http_status", `${url} returned HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml/.test(contentType)) {
    throw new EnrichError(
      "content_type",
      `${url} is ${contentType || "an unknown content type"} — only HTML pages can be enriched`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const truncated = buf.byteLength > PAGE_CAP;
  return {
    requested_url: url,
    final_url: res.url || url,
    http_status: res.status,
    content_type: contentType.split(";")[0].trim(),
    bytes: Math.min(buf.byteLength, PAGE_CAP),
    truncated,
    html: buf.subarray(0, PAGE_CAP).toString("utf8"),
  };
}

function registrableHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** Seed-page links worth following: same registrable domain, href or anchor
    text matching the about/grants/apply/team/... pattern. */
function discoverLinks(seedPage: BundlePage): string[] {
  const base = new URL(seedPage.final_url);
  const seedHost = registrableHost(base.hostname);
  const seen = new Set<string>([seedPage.final_url.replace(/#.*$/, "")]);
  const out: string[] = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seedPage.html)) !== null && out.length < MAX_SUBPAGES) {
    const href = m[1];
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const anchorText = m[2].replace(/<[^>]+>/g, " ");
    if (!LINK_RE.test(href) && !LINK_RE.test(anchorText)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (registrableHost(resolved.hostname) !== seedHost) continue;
    const key = resolved.toString().replace(/#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Fetch seed + up to 5 same-domain matched subpages, sequentially with ≥1s
    spacing and one retry each; subpage failures are skipped, seed failures
    throw. */
export async function fetchBundle(
  orgId: string,
  orgName: string,
  seedUrlRaw: string
): Promise<SnapshotBundle> {
  const seedUrl = assertPublicHttpUrl(seedUrlRaw);
  const robots = await checkRobots(seedUrl);
  if (!robots.allowed) {
    throw new EnrichError(
      "robots",
      `${seedUrl.hostname}/robots.txt disallows all crawling (${robots.matched_rule}) — not fetching`
    );
  }

  const seedPage = await fetchPage(seedUrl.toString());
  const pages: BundlePage[] = [seedPage];
  let bundleBytes = seedPage.bytes;

  for (const link of discoverLinks(seedPage)) {
    await sleep(1100);
    let page: BundlePage | null = null;
    for (let attempt = 0; attempt < 2 && !page; attempt++) {
      try {
        page = await fetchPage(link);
      } catch {
        if (attempt === 0) await sleep(1100); // one polite retry, then skip
      }
    }
    if (!page) continue;
    if (bundleBytes + page.bytes > BUNDLE_CAP) break;
    bundleBytes += page.bytes;
    pages.push(page);
  }

  return {
    schema: "funder_website_snapshot/v1",
    org_id: orgId,
    org_name: orgName,
    seed_url: seedUrl.toString(),
    fetched_at: new Date().toISOString(),
    triggered_by: "ui:zach",
    robots,
    pages,
  };
}

export interface SnapshotRecord {
  rawFileId: number;
  sha256: string;
  filename: string;
  storagePath: string;
}

function rawDir(): string {
  const root = process.env.FUNDERDB_RAW_DIR;
  if (!root) {
    throw new Error(
      "FUNDERDB_RAW_DIR is not set — point it at corpus/data/raw before enriching"
    );
  }
  return path.join(root, "funder_website");
}

/** Write the bundle to disk (sha-first filename), append the manifest line,
    and register it in internal.raw_files. Idempotent on sha256. */
export async function snapshotAndRegister(bundle: SnapshotBundle): Promise<SnapshotRecord> {
  const dir = rawDir();
  mkdirSync(dir, { recursive: true });

  const bytes = Buffer.from(JSON.stringify(bundle));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const date = bundle.fetched_at.slice(0, 10).replaceAll("-", "");
  const org8 = bundle.org_id.replaceAll("-", "").slice(0, 8);
  const filename = `${sha256.slice(0, 12)}_${date}_funder-website_${org8}.json`;
  const storagePath = `data/raw/funder_website/${filename}`;
  const finalUrl = bundle.pages[0].final_url;

  writeFileSync(path.join(dir, filename), bytes);
  appendFileSync(
    path.join(dir, "manifest.jsonl"),
    JSON.stringify({
      dataset: "funder_website",
      url: finalUrl,
      file: filename,
      sha256,
      bytes: bytes.byteLength,
    }) + "\n"
  );

  const meta = {
    org_id: bundle.org_id,
    seed_url: bundle.seed_url,
    final_url: finalUrl,
    page_count: bundle.pages.length,
    http_statuses: bundle.pages.map((p) => p.http_status),
    robots_allowed: bundle.robots.allowed,
    fetch_ua: FETCH_UA,
    triggered_by: bundle.triggered_by,
  };

  const [row] = await adminSql`
    insert into internal.raw_files
      (dataset_name, source_url, storage_path, sha256, byte_size,
       content_type, license_code, as_of_date, meta)
    values
      ('funder_website', ${finalUrl}, ${storagePath}, ${sha256},
       ${bytes.byteLength}, 'application/json', 'publisher_website',
       current_date, ${adminSql.json(meta)})
    on conflict (sha256) do update set source_url = excluded.source_url
    returning id`;

  return { rawFileId: Number(row.id), sha256, filename, storagePath };
}

/** Today's snapshot for this org, if one exists (offer reuse instead of
    re-fetching a site that hasn't changed since the morning). */
export async function sameDaySnapshot(
  orgId: string
): Promise<{ rawFileId: number; sha256: string; storagePath: string } | null> {
  const rows = await adminSql`
    select id, sha256, storage_path from internal.raw_files
    where dataset_name = 'funder_website'
      and meta->>'org_id' = ${orgId}
      and as_of_date = current_date
    order by id desc limit 1`;
  if (rows.length === 0) return null;
  return {
    rawFileId: Number(rows[0].id),
    sha256: rows[0].sha256,
    storagePath: rows[0].storage_path,
  };
}

export function readSnapshot(storagePath: string): SnapshotBundle {
  const file = path.join(rawDir(), path.basename(storagePath));
  return JSON.parse(readFileSync(file, "utf8")) as SnapshotBundle;
}

const EXTRACT_SYSTEM = `You extract structured facts about a grantmaking foundation from snapshots of its own website, for an internal research database.

Rules:
- Extract ONLY what the pages state. Never infer, embellish, or fill gaps from outside knowledge.
- Every non-null field must be supported by a verbatim snippet from the pages, recorded in "snippets" with the page URL it came from.
- Use null (or an empty array) for anything the pages do not say. accepts_unsolicited is null unless the site explicitly addresses unsolicited proposals.
- people: only names presented as current staff, board, or leadership; role is program_officer, executive, staff, or board; source_page is the page URL.
- extracted_summary: 2-3 sentences paraphrasing what the foundation says about itself. Paraphrase — do not copy sentences verbatim outside the snippets field.
- confidence: 0-1 per populated field, reflecting how directly the page supports the value.`;

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_web_facts",
  description: "Record the structured facts extracted from the foundation's website.",
  input_schema: {
    type: "object",
    properties: {
      website_url: {
        type: "string",
        description: "Canonical site URL as the site presents itself",
      },
      focus_areas: { type: "array", items: { type: "string" } },
      giving_priorities: { type: ["string", "null"] },
      application_info: {
        type: ["string", "null"],
        description: "Application process / deadlines / eligibility, prose",
      },
      application_url: { type: ["string", "null"] },
      accepts_unsolicited: { type: ["boolean", "null"] },
      geographic_focus: { type: "array", items: { type: "string" } },
      people: {
        type: "array",
        items: {
          type: "object",
          properties: {
            full_name: { type: "string" },
            title: { type: ["string", "null"] },
            role: { type: "string", enum: ["program_officer", "executive", "staff", "board"] },
            source_page: { type: "string" },
          },
          required: ["full_name", "role", "source_page"],
        },
      },
      extracted_summary: { type: ["string", "null"] },
      confidence: {
        type: "object",
        description: "0-1 per populated field, keyed by field name",
        additionalProperties: { type: "number" },
      },
      snippets: {
        type: "object",
        description: "Per-field verbatim supporting quote: {field: {page, excerpt}}",
        additionalProperties: {
          type: "object",
          properties: { page: { type: "string" }, excerpt: { type: "string" } },
        },
      },
    },
    required: ["website_url", "focus_areas", "geographic_focus", "people"],
  },
};

export interface ExtractedFacts {
  website_url: string;
  focus_areas: string[];
  giving_priorities: string | null;
  application_info: string | null;
  application_url: string | null;
  accepts_unsolicited: boolean | null;
  geographic_focus: string[];
  people: { full_name: string; title?: string | null; role: string; source_page: string }[];
  extracted_summary: string | null;
  confidence?: Record<string, number>;
  snippets?: Record<string, { page: string; excerpt: string }>;
}

export async function extractFacts(
  orgName: string,
  pages: BundlePage[]
): Promise<{ fields: ExtractedFacts; model: string }> {
  const combined = pages
    .map((p) => `PAGE: ${p.final_url}\n${htmlToText(p.html)}`)
    .join("\n\n=====\n\n");
  if (combined.replace(/PAGE: \S+/g, "").trim().length < 400) {
    throw new EnrichError(
      "extract",
      "The pages returned mostly scripts or no readable text — try a specific About or Grants page URL."
    );
  }

  const client = new Anthropic();
  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 4000,
      system: EXTRACT_SYSTEM,
      tools: [RECORD_TOOL],
      tool_choice: { type: "tool", name: "record_web_facts" },
      messages: [{ role: "user", content: `Foundation: ${orgName}\n\n${combined}` }],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new EnrichError("extract", `extraction call failed: ${msg}`);
  }

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!block) throw new EnrichError("extract", "extraction returned no structured result");
  return { fields: block.input as ExtractedFacts, model: EXTRACTION_MODEL };
}

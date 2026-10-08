import "server-only";

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { formatNumber } from "@/lib/format";
import { CREDIT_COSTS, PLANS, formatPlanPrice, isFeature, isPlanId } from "@/lib/plans";

/**
 * The docs loader. Guides are plain Markdown files in `content/docs/`, one
 * per guide, read with `fs` at build time (the docs pages are static). The
 * slug is the file name without `.md`.
 *
 * A guide starts with a small front-matter block:
 *
 *   ---
 *   title: Getting started
 *   description: One sentence shown on the index.
 *   group: nonprofits | developers
 *   order: 1
 *   ---
 *
 * Nothing here touches the database or the request, so the whole module is
 * safe to call from a cached or prerendered component.
 */

export const DOC_GROUPS = ["nonprofits", "developers"] as const;
export type DocGroup = (typeof DOC_GROUPS)[number];

export const DOC_GROUP_LABELS: Record<DocGroup, string> = {
  nonprofits: "For nonprofits",
  developers: "For developers and AI agents",
};

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  group: DocGroup;
  order: number;
};

export type DocHeading = { id: string; text: string; level: 2 | 3 };

export type Doc = DocMeta & {
  /** Markdown body with the front matter removed. */
  body: string;
  headings: DocHeading[];
};

/** Slugs are file names: lowercase words joined by single hyphens. */
export const docSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const frontMatterSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  group: z.enum(DOC_GROUPS).default("nonprofits"),
  order: z.coerce.number().int().min(0).default(999),
});

/** `content/docs` next to the app root (process.cwd() is `apps/web`). */
export const DOCS_DIR = path.join(process.cwd(), "content", "docs");

/**
 * Candidate locations of the repository CHANGELOG. The first is the monorepo
 * root when building from `apps/web`; the second covers a flattened deploy.
 */
export const CHANGELOG_PATHS = [
  path.join(process.cwd(), "..", "..", "CHANGELOG.md"),
  path.join(process.cwd(), "CHANGELOG.md"),
];

/** Split a Markdown file into its front matter (as a flat record) and body. */
export function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return { data: {}, body: normalized };
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: normalized };
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, "");
  const data: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    data[match[1]] = value;
  }
  return { data, body };
}

const PLAN_FIELDS = [
  "price",
  "members",
  "monthly_credits",
  "daily_credits",
  "saved_funders_limit",
  "pipelines_limit",
] as const;
type PlanField = (typeof PLAN_FIELDS)[number];

function isPlanField(v: string): v is PlanField {
  return (PLAN_FIELDS as readonly string[]).includes(v);
}

/** Null limits read "Unlimited" in prose; numbers get thousands separators. */
function limitText(v: number | null): string {
  return v === null ? "Unlimited" : formatNumber(v);
}

/**
 * Expand plan placeholders so guides never drift from lib/plans.ts:
 *   {{plans.free.monthly_credits}} → 25     {{plans.pro.price}} → $20
 *   {{plans.team.members}} → 10             {{credits.fit}} → 5
 * Unknown placeholders are left as written so a typo is visible on the page.
 */
export function expandPlanTokens(body: string): string {
  return body.replace(/\{\{\s*([a-z_]+)\.([a-z_]+)(?:\.([a-z_]+))?\s*\}\}/g, (match, kind, a, b) => {
    if (kind === "credits" && b === undefined && isFeature(a)) return String(CREDIT_COSTS[a]);
    if (kind === "plans" && isPlanId(a) && typeof b === "string" && isPlanField(b)) {
      const plan = PLANS[a];
      switch (b) {
        case "price":
          return formatPlanPrice(plan);
        case "members":
          return limitText(plan.members);
        case "monthly_credits":
          return limitText(plan.monthly_credits);
        case "daily_credits":
          return limitText(plan.daily_credits);
        case "saved_funders_limit":
          return limitText(plan.saved_funders_limit);
        case "pipelines_limit":
          return limitText(plan.pipelines_limit);
      }
    }
    return match;
  });
}

/** First `# Heading` in a body, for files without a title in front matter. */
function firstH1(body: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(body);
  return match ? match[1].trim() : null;
}

/** Heading text to a stable anchor id: "What a credit buys" → "what-a-credit-buys". */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** H2 and H3 headings outside fenced code blocks, in document order. */
export function extractHeadings(body: string): DocHeading[] {
  const headings: DocHeading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(##|###)\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    let id = slugifyHeading(text);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count + 1}`;
    headings.push({ id, text, level: match[1] === "##" ? 2 : 3 });
  }
  return headings;
}

function readDocFile(slug: string): Doc | null {
  const file = path.join(DOCS_DIR, `${slug}.md`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const { data, body: rawBody } = parseFrontMatter(raw);
  const body = expandPlanTokens(rawBody);
  const parsed = frontMatterSchema.safeParse({
    ...data,
    title: data.title ?? firstH1(body) ?? "",
    description: data.description ?? "",
  });
  if (!parsed.success) return null;
  return {
    slug,
    title: parsed.data.title,
    description: parsed.data.description,
    group: parsed.data.group,
    order: parsed.data.order,
    body,
    headings: extractHeadings(body),
  };
}

const GROUP_RANK: Record<DocGroup, number> = { nonprofits: 0, developers: 1 };

function compareDocs(a: DocMeta, b: DocMeta): number {
  return GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.order - b.order || a.title.localeCompare(b.title);
}

/** Every guide in `content/docs`, sorted by group, then order, then title. */
/** The index fields of a guide, without its body. */
function docMeta(doc: Doc): DocMeta {
  const { slug, title, description, group, order } = doc;
  return { slug, title, description, group, order };
}

export function listDocs(): DocMeta[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(DOCS_DIR);
  } catch {
    return [];
  }
  const docs: DocMeta[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const slug = entry.slice(0, -3);
    if (!docSlugSchema.safeParse(slug).success) continue;
    const doc = readDocFile(slug);
    if (!doc) continue;
    docs.push(docMeta(doc));
  }
  return docs.sort(compareDocs);
}

/** One guide by slug, or null when the slug is malformed or the file is missing. */
export function getDoc(slug: string): Doc | null {
  const parsed = docSlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return readDocFile(parsed.data);
}

/** Guides grouped for the index and the sidebar, in display order. */
export function docGroups(): Array<{ group: DocGroup; label: string; docs: DocMeta[] }> {
  const all = listDocs();
  return DOC_GROUPS.map((group) => ({
    group,
    label: DOC_GROUP_LABELS[group],
    docs: all.filter((d) => d.group === group),
  })).filter((g) => g.docs.length > 0);
}

/** Previous and next guide around `slug`, across groups. */
export function docNeighbours(slug: string): { prev: DocMeta | null; next: DocMeta | null } {
  const all = listDocs();
  const index = all.findIndex((d) => d.slug === slug);
  if (index === -1) return { prev: null, next: null };
  return { prev: all[index - 1] ?? null, next: all[index + 1] ?? null };
}

/** The repository CHANGELOG as Markdown, or null when it is not in this build. */
export function readChangelog(paths: readonly string[] = CHANGELOG_PATHS): string | null {
  for (const candidate of paths) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      if (raw.trim().length > 0) return raw.replace(/\r\n/g, "\n");
    } catch {
      // try the next location
    }
  }
  return null;
}

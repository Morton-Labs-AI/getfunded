import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  DOCS_DIR,
  docGroups,
  docNeighbours,
  docSlugSchema,
  expandPlanTokens,
  extractHeadings,
  getDoc,
  listDocs,
  parseFrontMatter,
  readChangelog,
  slugifyHeading,
} from "@/lib/docs";
import { CREDIT_COSTS, PLANS } from "@/lib/plans";

/** Every guide the marketing site promises. Adding a guide means adding it here. */
const EXPECTED_SLUGS = [
  "getting-started",
  "search-guide",
  "funder-profiles",
  "ai-and-credits",
  "workspace",
  "outreach",
  "faq",
  "self-install",
  "api",
  "data-sources-and-license",
  "governance-and-contributing",
  "security-and-privacy",
];

describe("docs loader", () => {
  it("reads from content/docs under the app root", () => {
    expect(DOCS_DIR.endsWith(path.join("content", "docs"))).toBe(true);
    expect(fs.existsSync(DOCS_DIR)).toBe(true);
  });

  it("finds every guide", () => {
    const slugs = listDocs().map((d) => d.slug);
    for (const slug of EXPECTED_SLUGS) expect(slugs).toContain(slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("gives every guide a title, a description and a group", () => {
    for (const doc of listDocs()) {
      expect(doc.title.trim().length, doc.slug).toBeGreaterThan(0);
      expect(doc.description.trim().length, doc.slug).toBeGreaterThan(0);
      expect(["nonprofits", "developers"]).toContain(doc.group);
    }
  });

  it("sorts nonprofit guides before developer guides, then by order", () => {
    const docs = listDocs();
    const firstDev = docs.findIndex((d) => d.group === "developers");
    const lastNonprofit = docs.map((d) => d.group).lastIndexOf("nonprofits");
    expect(lastNonprofit).toBeLessThan(firstDev);
    for (let i = 1; i < docs.length; i++) {
      if (docs[i].group === docs[i - 1].group) expect(docs[i].order).toBeGreaterThanOrEqual(docs[i - 1].order);
    }
    expect(docs[0].slug).toBe("getting-started");
  });

  it("loads a guide with its body and headings", () => {
    const doc = getDoc("getting-started");
    expect(doc).not.toBeNull();
    expect(doc!.body).toContain("## ");
    expect(doc!.headings.length).toBeGreaterThan(2);
    expect(doc!.headings.every((h) => h.id.length > 0 && (h.level === 2 || h.level === 3))).toBe(true);
    expect(doc!.headings.map((h) => h.text)).toContain("For developers and AI agents");
  });

  it("returns null for unknown or malformed slugs", () => {
    expect(getDoc("does-not-exist")).toBeNull();
    expect(getDoc("../package")).toBeNull();
    expect(getDoc("Getting-Started")).toBeNull();
    expect(getDoc("")).toBeNull();
    expect(docSlugSchema.safeParse("a--b").success).toBe(false);
  });

  it("groups guides for the sidebar", () => {
    const groups = docGroups();
    expect(groups.map((g) => g.group)).toEqual(["nonprofits", "developers"]);
    expect(groups[0].label).toBe("For nonprofits");
    expect(groups[1].label).toBe("For developers and AI agents");
    expect(groups[1].docs.map((d) => d.slug)).toContain("api");
  });

  it("finds previous and next guides", () => {
    const first = docNeighbours("getting-started");
    expect(first.prev).toBeNull();
    expect(first.next?.slug).toBe("search-guide");
    expect(docNeighbours("nope")).toEqual({ prev: null, next: null });
  });

  it("never leaves a plan placeholder unexpanded in a shipped guide", () => {
    for (const meta of listDocs()) {
      const doc = getDoc(meta.slug);
      expect(doc!.body, meta.slug).not.toMatch(/\{\{\s*(plans|credits)\./);
    }
  });

  it("promises only what is built: no Sequences section, knowledge base on every plan, no proration", () => {
    const outreach = getDoc("outreach")!.body;
    expect(outreach).not.toMatch(/^##.*Sequences/m);
    expect(outreach).toContain("## Follow-ups");
    expect(outreach).toMatch(/not built yet/i);
    const workspace = getDoc("workspace")!.body;
    expect(workspace).toMatch(/Every plan can keep a small knowledge base/);
    expect(workspace).not.toMatch(/Pro and above can keep a small knowledge base/);
    for (const meta of listDocs()) {
      expect(getDoc(meta.slug)!.body, meta.slug).not.toMatch(/prorat/i);
    }
  });

  it("keeps the credit table in the AI guide in step with lib/plans.ts", () => {
    const doc = getDoc("ai-and-credits")!;
    expect(doc.body).toContain(`| Free | ${PLANS.free.monthly_credits} | ${PLANS.free.daily_credits} |`);
    expect(doc.body).toContain(`| Fit analysis |`);
    expect(doc.body).toMatch(new RegExp(`\\| Fit analysis \\|[^|]*\\| ${CREDIT_COSTS.fit} \\|`));
  });
});

describe("front matter and helpers", () => {
  it("parses a front-matter block and strips it from the body", () => {
    const { data, body } = parseFrontMatter("---\ntitle: Hello\ndescription: \"A thing\"\norder: 3\n---\n\n# Hello\n\nText.\n");
    expect(data).toEqual({ title: "Hello", description: "A thing", order: "3" });
    expect(body.startsWith("# Hello")).toBe(true);
  });

  it("leaves a file without front matter alone", () => {
    const { data, body } = parseFrontMatter("# Plain\n\nText.");
    expect(data).toEqual({});
    expect(body).toBe("# Plain\n\nText.");
  });

  it("slugifies headings predictably", () => {
    expect(slugifyHeading("What a credit buys")).toBe("what-a-credit-buys");
    expect(slugifyHeading("Step 1: Search without an account")).toBe("step-1-search-without-an-account");
    expect(slugifyHeading("`code` and *emphasis*")).toBe("code-and-emphasis");
  });

  it("extracts H2/H3 outside code fences and de-duplicates ids", () => {
    const body = ["## Intro", "```", "## not a heading", "```", "### Sub", "## Intro", ""].join("\n");
    expect(extractHeadings(body)).toEqual([
      { id: "intro", text: "Intro", level: 2 },
      { id: "sub", text: "Sub", level: 3 },
      { id: "intro-2", text: "Intro", level: 2 },
    ]);
  });

  it("expands plan and credit placeholders from lib/plans.ts", () => {
    expect(expandPlanTokens("{{plans.free.monthly_credits}}")).toBe(String(PLANS.free.monthly_credits));
    expect(expandPlanTokens("{{plans.pro.price}}")).toBe("$20");
    expect(expandPlanTokens("{{plans.enterprise.members}}")).toBe("Unlimited");
    expect(expandPlanTokens("{{plans.team.monthly_credits}}")).toBe("3,000");
    expect(expandPlanTokens("{{credits.research}}")).toBe(String(CREDIT_COSTS.research));
    expect(expandPlanTokens("{{plans.nope.price}} {{credits.flying}}")).toBe("{{plans.nope.price}} {{credits.flying}}");
  });
});

describe("changelog", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gf-changelog-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("reads the first readable candidate", () => {
    const file = path.join(tmp, "CHANGELOG.md");
    fs.writeFileSync(file, "# Changelog\n\n## [Unreleased]\n");
    expect(readChangelog([path.join(tmp, "missing.md"), file])).toContain("## [Unreleased]");
  });

  it("returns null when no candidate exists", () => {
    expect(readChangelog([path.join(tmp, "missing.md")])).toBeNull();
  });

  it("finds the repository changelog from apps/web", () => {
    expect(readChangelog()).toMatch(/^# Changelog/);
  });
});

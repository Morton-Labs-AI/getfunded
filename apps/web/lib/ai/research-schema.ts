/**
 * The research dossier contract: what the web-search step must produce and
 * what is stored in `ai_analyses.output` for kind 'research'. Pure module.
 *
 * Honesty: a dossier is machine-written from public web pages. Every section
 * lists its sources; anything the notes do not support stays out; people are
 * named only with a role published by the funder or a cited news source,
 * and never with personal contact details.
 */
import { z } from "zod";
import type { Tool } from "@/lib/ai/types";
import type { EvidenceItem } from "./evidence";

export const RESEARCH_SCHEMA_VERSION = 1;
export const RESEARCH_PROMPT_VERSION = "research-p1";
/** A dossier younger than this is reused instead of re-searched (unless forced). */
export const RESEARCH_FRESH_DAYS = 30;

const url = z.string().max(2048);

export const DossierSchema = z
  .object({
    summary: z.string().min(20).max(3000),
    whatTheyFund: z.array(z.string().min(3).max(600)).max(10),
    recentGrantsInNews: z
      .array(
        z.object({
          headline: z.string().min(3).max(300),
          detail: z.string().max(800),
          date: z.string().max(40).nullable(),
          url: url.nullable(),
        }),
      )
      .max(12),
    people: z
      .array(
        z.object({
          name: z.string().min(2).max(200),
          role: z.string().min(2).max(200),
          url: url.nullable(),
        }),
      )
      .max(12),
    howToApproach: z.string().max(3000),
    cautions: z.array(z.string().min(3).max(500)).max(10),
    sources: z.array(z.object({ title: z.string().min(1).max(300), url })).max(40),
  })
  .strict();
export type Dossier = z.infer<typeof DossierSchema>;

export type ResearchOutput = Dossier & {
  schemaVersion: typeof RESEARCH_SCHEMA_VERSION;
  orgId: string;
  promptVersion: string;
  model: string;
  generatedAt: string;
  /** How many web searches the model made, when known. */
  mock: boolean;
};

/** http(s) only; anything else becomes null rather than a broken link. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Drop invalid URLs, de-duplicate sources, keep lengths sane. */
export function sanitizeDossier(d: Dossier): Dossier {
  const seen = new Set<string>();
  const sources: Dossier["sources"] = [];
  for (const s of d.sources) {
    const u = safeUrl(s.url);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    sources.push({ title: s.title.trim().slice(0, 300), url: u });
  }
  return {
    summary: d.summary.trim(),
    whatTheyFund: d.whatTheyFund.map((s) => s.trim()).filter(Boolean),
    recentGrantsInNews: d.recentGrantsInNews.map((n) => ({ ...n, headline: n.headline.trim(), detail: n.detail.trim(), url: safeUrl(n.url) })),
    people: d.people.map((p) => ({ name: p.name.trim(), role: p.role.trim(), url: safeUrl(p.url) })),
    howToApproach: d.howToApproach.trim(),
    cautions: d.cautions.map((c) => c.trim()).filter(Boolean),
    sources,
  };
}

export function readResearchOutput(value: unknown): ResearchOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ResearchOutput>;
  if (v.schemaVersion !== RESEARCH_SCHEMA_VERSION || typeof v.summary !== "string") return null;
  return v as ResearchOutput;
}

/* ------------------------------------------------------------------------ */
/* Prompts                                                                   */
/* ------------------------------------------------------------------------ */

export function buildNotesSystem(): string {
  return [
    "You are a research analyst helping a nonprofit fundraiser prepare to approach one grantmaker.",
    "Research the funder described by the user with web search and write cited notes.",
    "Rules:",
    "- Only state facts you found on a page you searched. Put the source URL in parentheses right",
    "  after each claim. If something is not published, write 'not published' rather than guessing.",
    "- Prefer the funder's own website, its grant announcements, its annual report, and recent news.",
    "- Name a person only when the funder's site or a cited news page states their role. Never",
    "  include personal email addresses, phone numbers or home addresses.",
    "- The filings facts in the user message are verified; do not contradict them, and use them",
    "  to tell this funder apart from others with similar names.",
    "- Never claim the funder is interested in the applicant. Never call an unstated application",
    "  posture 'closed'.",
    "Cover, with headings:",
    "1. What they fund (program areas, places, typical grant sizes if published, in their own words).",
    "2. Recent grants in the news (last 24 months): who received what, when, with links.",
    "3. People with public roles (board, staff, program officers) with the page that states the role.",
    "4. How to approach: application process, deadlines, letters of inquiry, who to write to (a role, not a private contact), and anything they say they do not fund.",
    "5. Cautions: things a fundraiser should check or avoid.",
    "6. A SOURCES list: every URL you used, one per line, with its page title.",
    "Keep it factual and specific. About 500-900 words.",
  ].join("\n");
}

export function buildNotesUser(input: { funderName: string; filingsFacts: string; applicantLine: string | null }): string {
  return [
    `FUNDER: ${input.funderName}`,
    "",
    "WHAT THE FILINGS SAY (verified):",
    input.filingsFacts,
    "",
    input.applicantLine ? `THE APPLICANT (for relevance only; never claim the funder knows them): ${input.applicantLine}` : "",
    "",
    "Research this funder now.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function buildStructureSystem(): string {
  return [
    "Convert research notes about one grantmaker into the structured dossier by calling emit_dossier.",
    "Keep only facts present in the notes. Use only URLs that appear in the notes or the source list.",
    "Leave a list empty rather than inventing an entry. Plain language, short sentences.",
    "people: only names whose role is stated in the notes; no contact details.",
    "howToApproach: what the notes say about process, deadlines and what they do not fund; if the notes say",
    "nothing, write one sentence saying the process is not published and suggest checking the filings' Part XV text.",
    "sources: every URL from the notes' SOURCES list, each with a short title.",
  ].join("\n");
}

export function buildStructureUser(notes: string): string {
  return `NOTES:\n${notes}`;
}

export function buildDossierTool(): Tool {
  return {
    name: "emit_dossier",
    description: "Emit the structured research dossier.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Three to five plain sentences on what this funder is and funds." },
        whatTheyFund: { type: "array", items: { type: "string" }, maxItems: 10, description: "One bullet per program area or priority, in the funder's words where possible." },
        recentGrantsInNews: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              headline: { type: "string" },
              detail: { type: "string" },
              date: { type: ["string", "null"], description: "YYYY-MM-DD or YYYY-MM when published, else null." },
              url: { type: ["string", "null"], format: "uri" },
            },
            required: ["headline", "detail", "date", "url"],
            additionalProperties: false,
          },
        },
        people: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: { name: { type: "string" }, role: { type: "string" }, url: { type: ["string", "null"], format: "uri" } },
            required: ["name", "role", "url"],
            additionalProperties: false,
          },
        },
        howToApproach: { type: "string" },
        cautions: { type: "array", items: { type: "string" }, maxItems: 10 },
        sources: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            properties: { title: { type: "string" }, url: { type: "string", format: "uri" } },
            required: ["title", "url"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "whatTheyFund", "recentGrantsInNews", "people", "howToApproach", "cautions", "sources"],
      additionalProperties: false,
    },
  };
}

/** Deterministic dossier for AI_MODE=mock, built only from the filings facts it was given. */
export function mockDossier(input: { funderName: string; items: ReadonlyArray<EvidenceItem> }): Dossier {
  const posture = input.items.find((i) => i.kind === "posture")?.text ?? null;
  const website = input.items.find((i) => i.kind === "website")?.text.replace(/^Website stated by the filer:\s*/, "").replace(/\.$/, "") ?? null;
  const grants = input.items.filter((i) => i.kind === "grant").slice(0, 3);
  const site = website && safeUrl(website.startsWith("http") ? website : `https://${website}`);
  return {
    summary:
      `Mock dossier for ${input.funderName}, generated by AI_MODE=mock without any web search. ` +
      "It repeats what the public filings already say and adds nothing from the web.",
    whatTheyFund: grants.map((g) => g.text.replace(/^Grant:\s*/, "")),
    recentGrantsInNews: [],
    people: [],
    howToApproach: posture ? posture : "The application process is not published in the filings on file. Check the funder's website.",
    cautions: ["This is mock output for development and testing. Run a real dossier before relying on it."],
    sources: site ? [{ title: "Website stated on the filing", url: site }] : [],
  };
}

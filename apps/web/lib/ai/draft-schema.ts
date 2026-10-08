/**
 * Outreach draft polish, the pure half: the claims package (template + funder
 * facts + dossier facts + applicant profile, each with an id), the tool, the
 * zod schema, and the deterministic checks that run before anything is
 * returned:
 *   - every claim cites an id from the package (validateClaimRefs),
 *   - the body never asserts the funder's interest (findInterestAssertions),
 *   - no leftover placeholders like [Name].
 * A draft that still fails after the one retry is refused. The tokens the
 * model billed are charged all the same (meter() settles the ledger row with
 * `meta.failed = true`); only a call that spent no tokens is refunded.
 */
import { z } from "zod";
import type { Tool } from "@/lib/ai/types";
import { addApplicantEvidence, readProfile } from "./applicant";
import { EvidenceBuilder, clip, renderPackage, unknownRefs, type EvidenceItem } from "./evidence";
import { DossierSchema } from "./research-schema";

export const DRAFT_PROMPT_VERSION = "draft-p1";

/**
 * The funder facts the polisher may use. Structurally compatible with the
 * search builder's FunderRecord (orgId + name are the only required fields).
 */
export type DraftFunder = {
  orgId: string;
  name: string;
  ein?: string | null;
  orgType?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  /** 'open' | 'preselected_only' | 'unknown' when known. */
  posture?: string | null;
  /** Part XV how-to-apply text when known. */
  howToApply?: string | null;
};

export const DraftOutputSchema = z
  .object({
    subject: z.string().min(1).max(150),
    body: z.string().min(60).max(5000),
    claims: z
      .array(z.object({ text: z.string().min(3).max(500), evidenceIds: z.array(z.string().min(1)).min(1).max(10) }))
      .min(1)
      .max(20),
  })
  .strict();
export type DraftOutput = z.infer<typeof DraftOutputSchema>;

export type PolishedDraft = {
  subject: string;
  body: string;
  /** One row per (claim, evidence id): the contract other builders consume. */
  claims: Array<{ text: string; evidenceId: string }>;
};

export function validateClaimRefs(claims: ReadonlyArray<{ evidenceIds: string[] }>, allowed: Set<string>): string[] {
  const out: string[] = [];
  claims.forEach((c, i) => out.push(...unknownRefs(c.evidenceIds, allowed, `claims[${i}]`)));
  return out;
}

/** Phrases that assert the funder's interest or a relationship that does not exist. */
export const INTEREST_PATTERNS: RegExp[] = [
  /\byou(?:'re| are) (?:clearly |very |so )?interested\b/i,
  /\byour (?:keen |strong |clear )?interest in\b/i,
  /\byou(?:'ll| will) (?:love|be excited|be thrilled|want)\b/i,
  /\b(?:we|i) know (?:that )?you(?:'re| are| care| support| fund| want)\b/i,
  /\bas (?:we|you) (?:discussed|agreed|spoke|talked|mentioned)\b/i,
  /\bper our (?:conversation|call|discussion)\b/i,
  /\byou (?:told|promised|assured|asked|invited) (?:us|me)\b/i,
  /\bthank you for (?:your interest|reaching out|inviting)\b/i,
  /\byou(?:'ve| have) (?:already )?(?:expressed|shown|signaled|signalled) interest\b/i,
  /\bexcited to (?:partner|work) with you\b/i,
  /\byour (?:commitment|support) to (?:us|our)\b/i,
  /\byou(?:'re| are) (?:a|the) (?:perfect|ideal|natural) (?:fit|match|partner)\b/i,
];

export function findInterestAssertions(text: string): string[] {
  const hits: string[] = [];
  for (const re of INTEREST_PATTERNS) {
    const m = re.exec(text);
    if (m) hits.push(m[0]);
  }
  return hits;
}

const PLACEHOLDER_RE = /\[(?:name|your name|funder|organization|org|date|amount|program|contact|insert[^\]]*|placeholder|xx+|tbd)\]/i;

/** Deterministic checks a draft must pass; returns the problems (empty = fine). */
export function draftProblems(out: DraftOutput, allowed: Set<string>): string[] {
  const problems: string[] = [];
  if (/[\r\n]/.test(out.subject)) problems.push("subject contains a line break");
  const interest = findInterestAssertions(`${out.subject}\n${out.body}`);
  for (const h of interest) problems.push(`the draft asserts the funder's interest or a relationship: "${h}"`);
  const ph = PLACEHOLDER_RE.exec(out.body) ?? PLACEHOLDER_RE.exec(out.subject);
  if (ph) problems.push(`the draft still contains a placeholder: ${ph[0]}`);
  problems.push(...validateClaimRefs(out.claims, allowed));
  return problems;
}

export type DraftPackage = { items: EvidenceItem[]; funderName: string; applicantName: string };

const POSTURE_WORDS: Record<string, string> = {
  open: "Accepts applications",
  preselected_only: "Funds preselected organizations only",
  unknown: "Not stated in filings",
};

/**
 * The claims package: the template itself, the funder's public facts, the
 * dossier facts (when a dossier exists), and the applicant profile. The
 * model may say nothing that is not in here.
 */
export function buildDraftPackage(input: { template: string; funder: DraftFunder; dossier?: unknown; orgProfile: unknown; applicantName?: string }): DraftPackage {
  const b = new EvidenceBuilder();
  b.add("template", "yours", "template", `The person's own template, to keep in substance: ${clip(input.template, 4000)}`, { label: "Your template" });

  const f = input.funder;
  const place = [f.city, f.state].filter(Boolean).join(", ");
  b.add("identity", "source", "funder_identity", `Funder: ${f.name}${f.orgType ? ` (${f.orgType.replace(/_/g, " ")})` : ""}${place ? `, ${place}` : ""}${f.ein ? `, EIN ${f.ein}` : ""}.`, {
    label: "IRS filings",
  });
  if (f.website) b.add("website", "source", "funder_website", `Funder website stated on its filing: ${f.website}.`, { label: "IRS filing" });
  if (f.posture) {
    b.add("posture", "source", "funder_posture", `Application posture from the latest 990-PF: ${POSTURE_WORDS[f.posture] ?? "Not stated in filings"}.${f.howToApply ? ` How to apply: ${clip(f.howToApply, 400)}` : ""}`, {
      label: "IRS 990-PF · Part XV",
    });
  }

  const dossier = input.dossier ? DossierSchema.partial().safeParse(input.dossier) : null;
  if (dossier?.success) {
    const d = dossier.data;
    if (d.summary) b.add("dossier", "source", "dossier_summary", `From web research: ${clip(d.summary, 800)}`, { label: "Web research (AI)" });
    for (const w of (d.whatTheyFund ?? []).slice(0, 6)) b.add("dossier", "source", "dossier_funds_", `From web research, what they fund: ${clip(w, 300)}`, { label: "Web research (AI)" });
    if (d.howToApproach) b.add("dossier", "source", "dossier_approach", `From web research, how to approach: ${clip(d.howToApproach, 600)}`, { label: "Web research (AI)" });
    for (const n of (d.recentGrantsInNews ?? []).slice(0, 4)) {
      b.add("dossier", "source", "dossier_news_", `From web research, recent grant in the news: ${clip(n.headline, 200)}${n.detail ? ` — ${clip(n.detail, 300)}` : ""}`, { label: "Web research (AI)", href: n.url ?? null });
    }
  }

  const applicantName = input.applicantName ?? "Your organization";
  addApplicantEvidence(b, { name: applicantName, profile: readProfile(input.orgProfile), knowledge: [] });
  return { items: b.items, funderName: f.name, applicantName };
}

export function buildDraftSystem(): string {
  return [
    "You polish an outreach email a nonprofit fundraiser wrote to a grantmaker. You rewrite the",
    "template so it is warm, specific, short and plain, keeping its substance and sign-off.",
    "",
    "You will receive a CLAIMS PACKAGE: everything you are allowed to say, each item with an id.",
    "Rules:",
    "- Write ONLY from the package. Never invent programs, numbers, deadlines, names, shared history",
    "  or relationships. If the package is thin, write a shorter email rather than a fuller fiction.",
    "- Never claim or imply that the funder is interested in the applicant, has met them, or has",
    "  invited this email. Never 'as we discussed', never 'your interest in'. The funder may never",
    "  have heard of the applicant.",
    "- Every factual statement about the funder or the applicant appears in `claims`, citing the",
    "  package id(s) it rests on. The applicant's own hopes ('we think there may be a fit') need no citation.",
    "- 'Not stated in filings' means the filing is silent; never call the funder closed.",
    "- Plain language, short sentences, contractions are fine, no jargon, no bullet lists, no",
    "  placeholders like [Name], no em dashes, under 180 words. Keep the person's sign-off.",
    "- One low-pressure ask that is easy to answer either way.",
    "- Subject: specific and quiet, under 80 characters, no exclamation marks.",
    "Call emit_draft exactly once.",
  ].join("\n");
}

export function buildDraftUser(pkg: DraftPackage): string {
  return [`FUNDER: ${pkg.funderName}`, `APPLICANT: ${pkg.applicantName}`, "", "CLAIMS PACKAGE (cite these ids exactly):", renderPackage(pkg.items)].join("\n");
}

export function buildDraftRetry(problems: ReadonlyArray<string>): string {
  return ["Your draft was rejected for these reasons. Fix them and call emit_draft again:", ...problems.map((p) => `- ${p}`)].join("\n");
}

export function buildDraftTool(): Tool {
  return {
    name: "emit_draft",
    description: "Emit the polished email with its claims map.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Under 80 characters." },
        body: { type: "string", description: "Plain-text email body, under 180 words, with the sign-off." },
        claims: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "One factual claim the email makes." },
              evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, description: "Package ids this claim rests on." },
            },
            required: ["text", "evidenceIds"],
            additionalProperties: false,
          },
        },
      },
      required: ["subject", "body", "claims"],
      additionalProperties: false,
    },
  };
}

/** Flatten (claim, ids[]) into the one-id-per-row contract. */
export function toPolishedDraft(out: DraftOutput): PolishedDraft {
  return {
    subject: out.subject.trim(),
    body: out.body.trim(),
    claims: out.claims.flatMap((c) => c.evidenceIds.map((evidenceId) => ({ text: c.text, evidenceId }))),
  };
}

/** AI_MODE=mock: returns the template lightly tidied, citing real package ids. */
export function mockDraftOutput(pkg: DraftPackage, template: string): DraftOutput {
  const body = template.replace(/\s+\n/g, "\n").trim();
  const padded = body.length >= 60 ? body : `${body}\n\nWe would welcome a short conversation about whether our work fits what you fund.\n\nThank you.`;
  return {
    subject: `A note about ${pkg.applicantName} and ${pkg.funderName}`.slice(0, 150),
    body: padded,
    claims: [{ text: `The email introduces ${pkg.applicantName} to ${pkg.funderName}.`, evidenceIds: ["funder_identity", "applicant_profile"] }],
  };
}

/**
 * Prompt assembly for the fit analysis. Versioned (FIT_PROMPT_VERSION in
 * fit-schema.ts): the version is stamped on every analysis row and folded into
 * the staleness fingerprint, so a prompt change never silently rewrites what an
 * older analysis meant.
 *
 * THE GUARDRAIL: the model reasons only from the evidence package. The
 * applicant side comes exclusively from the workspace profile and approved
 * knowledge rows; the funder side only from public filings and the corpus.
 */
import { renderPackage, type EvidenceItem } from "./evidence";
import { FIT_DIMENSIONS, FIT_DIMENSION_HINTS } from "./fit-schema";

export type FitPromptInput = {
  funderName: string;
  applicantName: string;
  items: ReadonlyArray<EvidenceItem>;
};

export function buildFitSystem(): string {
  return [
    "You assess how well one grantmaker fits one nonprofit applicant, for a fundraiser",
    "who will read your answer and decide whether to spend time on this funder.",
    "",
    "You will receive an EVIDENCE PACKAGE with two parts: FUNDER items (from public IRS",
    "filings and the Open Funder Database) and APPLICANT items (the nonprofit's own",
    "profile and approved facts). Score seven fit dimensions from 0 to 100, each with",
    "one plain-language statement citing evidence ids from the package.",
    "",
    "Rules:",
    "- Reason ONLY from the package. If evidence is absent, score with low confidence",
    "  and say what is missing. Never invent grants, places, people, or eligibility.",
    "- 'Not stated in filings' is an ABSENCE of a statement, not a closed door. Treat",
    "  it as neutral for openness unless other evidence bears on it. Never say 'closed'.",
    "- Missing numbers are 'not available', never zero.",
    "- suggestedAsk must be grounded in the funder's actual grant sizes in the package,",
    "  not the applicant's need. Return null when the grant evidence is too thin.",
    "- Plain language. Short sentences. No jargon. Write for a busy nonprofit staffer.",
    "- Every statement, reason, concern and ask cites at least one evidence id, copied",
    "  exactly as written in square brackets.",
    "- Do NOT compute an overall score. That is done downstream from your dimension scores.",
    "",
    "Dimensions:",
    ...FIT_DIMENSIONS.map((k) => `- ${k}: ${FIT_DIMENSION_HINTS[k]}`),
    "",
    "Call emit_fit_analysis exactly once.",
  ].join("\n");
}

export function buildFitUser(input: FitPromptInput): string {
  return [
    `FUNDER: ${input.funderName}`,
    `APPLICANT: ${input.applicantName}`,
    "",
    "EVIDENCE PACKAGE (cite these ids exactly):",
    renderPackage(input.items),
  ].join("\n");
}

/** The second-attempt nudge: names the violations so the retry fixes them instead of guessing. */
export function buildFitRetry(violations: ReadonlyArray<string>): string {
  return [
    "Your previous output was rejected for these reasons. Fix them and call",
    "emit_fit_analysis again, citing only ids that appear in the package:",
    ...violations.map((v) => `- ${v}`),
  ].join("\n");
}

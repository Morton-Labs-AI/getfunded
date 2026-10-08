/**
 * The fit analysis contract: seven dimensions, versioned weights, the
 * deterministic composite, and the zod schema the model's tool call must
 * pass. Pure module (no server imports) so every rule here is unit-tested.
 *
 * Two structural rules, enforced in code rather than by convention:
 *   1. Every reason cites at least one evidence id from the package the model
 *      was shown. No orphan claims.
 *   2. The composite score is computed by `composeScore()` from the seven
 *      dimension scores x the versioned weights. The model never does the
 *      arithmetic.
 */
import { z } from "zod";
import type { Tool } from "@/lib/ai/types";
import { unknownRefs, type EvidenceItem } from "./evidence";

export const FIT_SCHEMA_VERSION = 1;
export const FIT_PROMPT_VERSION = "fit-p1";

export const FIT_DIMENSIONS = [
  "mission_alignment",
  "geography",
  "grant_size_fit",
  "applicant_eligibility",
  "recency",
  "capacity",
  "openness",
] as const;
export type FitDimension = (typeof FIT_DIMENSIONS)[number];

export const FIT_DIMENSION_LABELS: Record<FitDimension, string> = {
  mission_alignment: "Mission alignment",
  geography: "Geography",
  grant_size_fit: "Grant size fit",
  applicant_eligibility: "Eligibility",
  recency: "Recent giving",
  capacity: "Capacity to give",
  openness: "Openness to applications",
};

export const FIT_DIMENSION_HINTS: Record<FitDimension, string> = {
  mission_alignment:
    "How closely what this funder actually pays for (grant purposes, recipients, NTEE focus) matches the applicant's mission and program areas.",
  geography: "Whether this funder gives where the applicant works (recipient states and places vs the applicant's state and counties).",
  grant_size_fit: "Whether the funder's typical grant sizes make sense next to the applicant's annual budget.",
  applicant_eligibility:
    "Whether the applicant's organization type and the people it serves fit any stated restrictions or recipient patterns.",
  recency: "How recent and how steady the giving history on file is.",
  capacity: "Whether the funder's distributions and assets show real capacity to make new grants.",
  openness:
    "Application posture. 'Accepts applications' is high; 'Not stated in filings' is an absence, not a closed door (score it as neutral unless other evidence bears on it); 'preselected only' is low unless other evidence bears on it.",
};

/**
 * Versioned weights. Changing a number here is a new version: the version is
 * stamped on every analysis row and folded into the staleness fingerprint,
 * so a tuning change never silently rewrites history.
 */
export type FitWeights = Record<FitDimension, number>;

export const FIT_WEIGHTS_VERSION = "w1";
export const FIT_WEIGHTS: FitWeights = {
  mission_alignment: 0.25,
  geography: 0.15,
  grant_size_fit: 0.15,
  applicant_eligibility: 0.15,
  recency: 0.1,
  capacity: 0.1,
  openness: 0.1,
};

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/** Weighted mean of the dimension scores, rounded to a whole number. */
export function composeScore(scores: Record<FitDimension, number>, weights: FitWeights = FIT_WEIGHTS): number {
  let sum = 0;
  let weightSum = 0;
  for (const k of FIT_DIMENSIONS) {
    const w = weights[k] ?? 0;
    sum += clamp(scores[k]) * w;
    weightSum += w;
  }
  if (weightSum === 0) return 0;
  return Math.round(sum / weightSum);
}

export type FitRating = "very_high" | "high" | "medium" | "low" | "very_low";

export function ratingForScore(score: number): FitRating {
  if (score >= 85) return "very_high";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  if (score >= 30) return "low";
  return "very_low";
}

/* ------------------------------------------------------------------------ */
/* Model output                                                              */
/* ------------------------------------------------------------------------ */

const Confidence = z.enum(["low", "medium", "high"]);

/**
 * Prose ceilings are generous on purpose: a long sentence is a formatting
 * quibble and the UI truncates. The floors carry the meaning: at least one
 * evidence id per claim, every dimension present, no unknown keys.
 */
const ReasonSchema = z.object({
  statement: z.string().min(8).max(2000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  confidence: Confidence,
});
export type FitReason = z.infer<typeof ReasonSchema>;

const DimensionSchema = z.object({
  score: z.number().min(0).max(100),
  statement: z.string().min(8).max(2000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
  confidence: Confidence,
});
export type FitDimensionOutput = z.infer<typeof DimensionSchema>;

const dimensionShape = Object.fromEntries(FIT_DIMENSIONS.map((k) => [k, DimensionSchema])) as Record<
  FitDimension,
  typeof DimensionSchema
>;

export const ModelFitOutputSchema = z
  .object({
    dimensions: z.object(dimensionShape).strict(),
    summary: z.string().min(20).max(3000),
    topReasons: z.array(ReasonSchema).min(1).max(5),
    concerns: z.array(ReasonSchema).max(5),
    /** Grounded in the funder's own award sizes, never the applicant's need. Null = not enough evidence. */
    suggestedAsk: z
      .object({
        min: z.number().nonnegative().nullable(),
        max: z.number().nonnegative().nullable(),
        confidence: Confidence,
        rationale: z.string().min(8).max(2000),
        evidenceIds: z.array(z.string().min(1)).min(1).max(20),
      })
      .nullable()
      .default(null),
    suggestedNextStep: z
      .object({ action: z.string().min(4).max(2000), rationale: z.string().min(8).max(2000) })
      .nullable()
      .default(null),
    /** "Lead with / support with / avoid leading with". */
    approachAngle: z.string().max(2000).nullable().default(null),
  })
  .strict();
export type ModelFitOutput = z.infer<typeof ModelFitOutputSchema>;

/** Every cited id must exist in the package; an ask range must not be inverted. */
export function validateFitRefs(out: ModelFitOutput, allowed: Set<string>): string[] {
  const violations: string[] = [];
  for (const k of FIT_DIMENSIONS) violations.push(...unknownRefs(out.dimensions[k].evidenceIds, allowed, `dimensions.${k}`));
  out.topReasons.forEach((r, i) => violations.push(...unknownRefs(r.evidenceIds, allowed, `topReasons[${i}]`)));
  out.concerns.forEach((r, i) => violations.push(...unknownRefs(r.evidenceIds, allowed, `concerns[${i}]`)));
  if (out.suggestedAsk) {
    violations.push(...unknownRefs(out.suggestedAsk.evidenceIds, allowed, "suggestedAsk"));
    const { min, max } = out.suggestedAsk;
    if (min !== null && max !== null && min > max) violations.push("suggestedAsk.min exceeds suggestedAsk.max");
  }
  return violations;
}

/** The tool the model must call. Strict-mode friendly: every object closes with additionalProperties=false. */
export function buildFitTool(): Tool {
  const reason = {
    type: "object" as const,
    properties: {
      statement: { type: "string", description: "One plain-language sentence." },
      evidenceIds: { type: "array", items: { type: "string" }, minItems: 1, description: "Ids from the evidence package." },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["statement", "evidenceIds", "confidence"],
    additionalProperties: false,
  };
  const dimension = {
    type: "object" as const,
    properties: {
      score: { type: "number", minimum: 0, maximum: 100 },
      statement: { type: "string" },
      evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["score", "statement", "evidenceIds", "confidence"],
    additionalProperties: false,
  };
  return {
    name: "emit_fit_analysis",
    description: "Emit the structured fit analysis for one funder and one applicant.",
    input_schema: {
      type: "object",
      properties: {
        dimensions: {
          type: "object",
          properties: Object.fromEntries(FIT_DIMENSIONS.map((k) => [k, dimension])),
          required: [...FIT_DIMENSIONS],
          additionalProperties: false,
        },
        summary: { type: "string", description: "Three to five plain sentences a fundraiser can act on." },
        topReasons: { type: "array", items: reason, minItems: 1, maxItems: 5 },
        concerns: { type: "array", items: reason, minItems: 0, maxItems: 5 },
        suggestedAsk: {
          type: ["object", "null"],
          description: "A range grounded in this funder's actual grant sizes, or null when the evidence is too thin.",
          properties: {
            min: { type: ["number", "null"] },
            max: { type: ["number", "null"] },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            rationale: { type: "string" },
            evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
          },
          required: ["min", "max", "confidence", "rationale", "evidenceIds"],
          additionalProperties: false,
        },
        suggestedNextStep: {
          type: ["object", "null"],
          properties: { action: { type: "string" }, rationale: { type: "string" } },
          required: ["action", "rationale"],
          additionalProperties: false,
        },
        approachAngle: {
          type: ["string", "null"],
          description: "Lead with / support with / avoid leading with. Null when nothing in the evidence supports one.",
        },
      },
      required: ["dimensions", "summary", "topReasons", "concerns", "suggestedAsk", "suggestedNextStep", "approachAngle"],
      additionalProperties: false,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Stored analysis                                                           */
/* ------------------------------------------------------------------------ */

/** What `ai_analyses.output` holds for kind 'fit'. Evidence ids resolve against `ai_analyses.evidence`. */
export type FitAnalysis = {
  schemaVersion: typeof FIT_SCHEMA_VERSION;
  orgId: string;
  overallScore: number;
  rating: FitRating;
  dimensions: Record<FitDimension, FitDimensionOutput>;
  summary: string;
  topReasons: FitReason[];
  concerns: FitReason[];
  suggestedAsk: ModelFitOutput["suggestedAsk"];
  suggestedNextStep: ModelFitOutput["suggestedNextStep"];
  approachAngle: string | null;
  promptVersion: string;
  weightsVersion: string;
  weights: FitWeights;
  model: string;
  generatedAt: string;
};

export function toFitAnalysis(input: {
  orgId: string;
  out: ModelFitOutput;
  model: string;
  weights?: FitWeights;
  weightsVersion?: string;
  now?: Date;
}): FitAnalysis {
  const weights = input.weights ?? FIT_WEIGHTS;
  const scores = Object.fromEntries(FIT_DIMENSIONS.map((k) => [k, input.out.dimensions[k].score])) as Record<
    FitDimension,
    number
  >;
  const overallScore = composeScore(scores, weights);
  return {
    schemaVersion: FIT_SCHEMA_VERSION,
    orgId: input.orgId,
    overallScore,
    rating: ratingForScore(overallScore),
    dimensions: input.out.dimensions,
    summary: input.out.summary,
    topReasons: input.out.topReasons,
    concerns: input.out.concerns,
    suggestedAsk: input.out.suggestedAsk,
    suggestedNextStep: input.out.suggestedNextStep,
    approachAngle: input.out.approachAngle,
    promptVersion: FIT_PROMPT_VERSION,
    weightsVersion: input.weightsVersion ?? FIT_WEIGHTS_VERSION,
    weights,
    model: input.model,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Loose reader for a stored output row. Returns null when the row is not a v1 fit analysis. */
export function readFitAnalysis(value: unknown): FitAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<FitAnalysis>;
  if (v.schemaVersion !== FIT_SCHEMA_VERSION || !v.dimensions || typeof v.overallScore !== "number") return null;
  return v as FitAnalysis;
}

/** Evidence items as stored in `ai_analyses.evidence` ({ items: [...] }). */
export function readEvidenceItems(value: unknown): EvidenceItem[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((i): i is EvidenceItem => Boolean(i) && typeof i === "object" && typeof (i as EvidenceItem).id === "string");
}

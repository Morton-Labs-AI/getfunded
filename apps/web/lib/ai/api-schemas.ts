/**
 * Request bodies and response shapes for the /api/ai/* routes. Pure module:
 * the route handlers parse with these schemas (through `boundedJson`), the
 * client components import the response types, and the unit tests exercise
 * the schemas without touching a server module.
 *
 * Every body is small and bounded. Ids are UUIDs or they are refused before a
 * query runs; free text has a ceiling the model never sees past.
 */
import { z } from "zod";
import type { SearchParams } from "@/lib/search/params";
import type { PolishedDraft } from "./draft-schema";
import type { EvidenceItem } from "./evidence";
import type { FilterChip } from "./filter-schema";
import type { FitAnalysis } from "./fit-schema";
import type { ResearchOutput } from "./research-schema";

/* ---------------------------------------------------------------- bodies */

/** POST /api/ai/filter: one sentence plus the current query-string params (so "also in Oregon" refines). */
export const FilterBody = z.object({
  sentence: z.string().trim().min(2).max(500),
  current: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});
export type FilterBody = z.infer<typeof FilterBody>;

/** POST /api/ai/fit: analyze (or reuse) the fit for one funder. */
export const FitBody = z.object({
  orgId: z.uuid(),
  savedFunderId: z.uuid().nullish(),
  /** Re-run even when nothing changed (the "Re-analyze" button). */
  force: z.boolean().optional(),
});
export type FitBody = z.infer<typeof FitBody>;

/** POST /api/ai/ask: a question plus up to 12 earlier turns kept by the chat component. */
export const AskBody = z.object({
  question: z.string().trim().min(3).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) }))
    .max(12)
    .optional(),
});
export type AskBody = z.infer<typeof AskBody>;

/** POST /api/ai/research: a web research dossier for one funder. */
export const ResearchBody = z.object({
  orgId: z.uuid(),
  savedFunderId: z.uuid().nullish(),
  /** Search again even when a fresh dossier exists. */
  force: z.boolean().optional(),
});
export type ResearchBody = z.infer<typeof ResearchBody>;

/** POST /api/ai/draft: polish the person's own template for one funder. */
export const DraftBody = z.object({
  orgId: z.uuid(),
  template: z.string().trim().min(20).max(6000),
  savedFunderId: z.uuid().nullish(),
});
export type DraftBody = z.infer<typeof DraftBody>;

export const FEEDBACK_VERDICTS = ["accepted", "edited", "dismissed"] as const;

/** POST /api/ai/feedback: a verdict on one stored analysis (append-only). */
export const FeedbackBody = z.object({
  analysisId: z.uuid(),
  verdict: z.enum(FEEDBACK_VERDICTS),
  /** Only meaningful with verdict 'edited'. Bounded by the route's body cap. */
  editedOutput: z.unknown().optional(),
});
export type FeedbackBody = z.infer<typeof FeedbackBody>;

/* ------------------------------------------------------------- responses */

/** The one error shape every /api/ai/* route answers with. */
export type AiErrorBody = {
  error: {
    code: string;
    message: string;
    upgradeUrl?: string;
    [key: string]: unknown;
  };
};

export type FilterDropped = { chip: FilterChip; reason: string };

export type FilterResponse = {
  /** The full search state to navigate to (serialize with `toQueryString`). */
  params: SearchParams;
  /** Every filter the sentence set, in chip order. */
  chips: FilterChip[];
  /** Filters the model set that the search page cannot express yet. */
  dropped: FilterDropped[];
  /** True when the sentence described a new search rather than a refinement. */
  replace: boolean;
  interpretation: string;
  mock: boolean;
  credits: number;
};

export type FitResponse = {
  analysisId: string;
  /** True when a fresh analysis already existed and no credits were spent. */
  reused: boolean;
  isMock: boolean;
  analysis: FitAnalysis;
  evidence: EvidenceItem[];
  credits: number;
};

export type ResearchResponse = {
  analysisId: string;
  reused: boolean;
  isMock: boolean;
  dossier: ResearchOutput;
  credits: number;
};

export type DraftResponse = {
  draft: PolishedDraft;
  credits: number;
};

export type FeedbackResponse = {
  id: string;
  verdict: (typeof FEEDBACK_VERDICTS)[number];
};

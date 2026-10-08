// @vitest-environment node
/**
 * The /api/ai/* request bodies (lib/ai/api-schemas.ts). Every id is a UUID or
 * the body is refused; free text has a floor and a ceiling; nothing optional
 * is required.
 */
import { describe, expect, it } from "vitest";

import { AskBody, DraftBody, FEEDBACK_VERDICTS, FeedbackBody, FilterBody, FitBody, ResearchBody } from "@/lib/ai/api-schemas";

const ORG = "11111111-1111-4111-8111-111111111111";
const SAVED = "22222222-2222-4222-8222-222222222222";

describe("FilterBody", () => {
  it("accepts a sentence with optional current params (strings or string arrays)", () => {
    const ok = FilterBody.parse({ sentence: "  Oregon foundations that accept applications ", current: { state: "OR", type: ["private_foundation"] } });
    expect(ok.sentence).toBe("Oregon foundations that accept applications");
    expect(ok.current).toEqual({ state: "OR", type: ["private_foundation"] });
    expect(FilterBody.parse({ sentence: "ok" }).current).toBeUndefined();
  });
  it("refuses a one-character or 501-character sentence and non-string params", () => {
    expect(FilterBody.safeParse({ sentence: "a" }).success).toBe(false);
    expect(FilterBody.safeParse({ sentence: "x".repeat(501) }).success).toBe(false);
    expect(FilterBody.safeParse({ sentence: "fine", current: { page: 2 } }).success).toBe(false);
    expect(FilterBody.safeParse({}).success).toBe(false);
  });
});

describe("FitBody / ResearchBody", () => {
  it("require a UUID org id and allow a nullable saved funder id and force", () => {
    expect(FitBody.parse({ orgId: ORG })).toEqual({ orgId: ORG });
    expect(FitBody.parse({ orgId: ORG, savedFunderId: null, force: true })).toEqual({ orgId: ORG, savedFunderId: null, force: true });
    expect(FitBody.parse({ orgId: ORG, savedFunderId: SAVED }).savedFunderId).toBe(SAVED);
    expect(ResearchBody.parse({ orgId: ORG, force: false })).toEqual({ orgId: ORG, force: false });
  });
  it("refuse a non-UUID org id, a non-UUID saved funder id and a non-boolean force", () => {
    expect(FitBody.safeParse({ orgId: "not-an-id" }).success).toBe(false);
    expect(FitBody.safeParse({ orgId: ORG, savedFunderId: "abc" }).success).toBe(false);
    expect(FitBody.safeParse({ orgId: ORG, force: "yes" }).success).toBe(false);
    expect(ResearchBody.safeParse({ orgId: 123 }).success).toBe(false);
  });
});

describe("AskBody", () => {
  it("accepts a question with up to 12 history turns", () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), content: `turn ${i}` }));
    const ok = AskBody.parse({ question: " Which Texas foundations accept applications? ", history });
    expect(ok.question).toBe("Which Texas foundations accept applications?");
    expect(ok.history).toHaveLength(12);
  });
  it("refuses short questions, long questions, 13 turns, unknown roles and empty turns", () => {
    expect(AskBody.safeParse({ question: "hi" }).success).toBe(false);
    expect(AskBody.safeParse({ question: "x".repeat(2001) }).success).toBe(false);
    const thirteen = Array.from({ length: 13 }, () => ({ role: "user", content: "q" }));
    expect(AskBody.safeParse({ question: "long enough", history: thirteen }).success).toBe(false);
    expect(AskBody.safeParse({ question: "long enough", history: [{ role: "system", content: "x" }] }).success).toBe(false);
    expect(AskBody.safeParse({ question: "long enough", history: [{ role: "user", content: "   " }] }).success).toBe(false);
  });
});

describe("DraftBody", () => {
  it("needs a UUID org id and a template of 20 to 6000 characters", () => {
    const template = "Dear grants committee, we run a food bank in Lane County and would welcome a conversation.";
    expect(DraftBody.parse({ orgId: ORG, template }).template).toBe(template);
    expect(DraftBody.safeParse({ orgId: ORG, template: "too short" }).success).toBe(false);
    expect(DraftBody.safeParse({ orgId: ORG, template: "x".repeat(6001) }).success).toBe(false);
    expect(DraftBody.safeParse({ orgId: "nope", template }).success).toBe(false);
  });
});

describe("FeedbackBody", () => {
  it("accepts the three verdicts and an optional edited output", () => {
    expect(FEEDBACK_VERDICTS).toEqual(["accepted", "edited", "dismissed"]);
    for (const verdict of FEEDBACK_VERDICTS) {
      expect(FeedbackBody.parse({ analysisId: ORG, verdict })).toEqual({ analysisId: ORG, verdict });
    }
    expect(FeedbackBody.parse({ analysisId: ORG, verdict: "edited", editedOutput: { summary: "x" } }).editedOutput).toEqual({ summary: "x" });
  });
  it("refuses an unknown verdict or a non-UUID analysis id", () => {
    expect(FeedbackBody.safeParse({ analysisId: ORG, verdict: "liked" }).success).toBe(false);
    expect(FeedbackBody.safeParse({ analysisId: "1", verdict: "accepted" }).success).toBe(false);
  });
});

# `lib/ai`: how a model call is paid for and how its output is kept honest

Two rules hold everything in this folder together. Every model call goes through
`meter()`. Every claim a model makes points at an evidence id it was given.

## 1. Metering: one door, always paid for

`lib/ai/client.ts` is the only file that imports `@anthropic-ai/sdk`
(`tests/unit/ai/sdk-boundary.test.ts` fails the build otherwise). Nothing in
`lib/ai/*` or `app/api/ai/*` imports it. A feature module asks for a model like
this:

```ts
return meter(
  { userId, workspaceId, feature: "fit", meta: { org_id } },
  async (ai, reservation) => {
    const res = await ai.fast(request);          // or ai.deep / ai.stream
    return { result, usage: res.usage };          // real token counts
  },
);
```

`meter()` (`lib/billing/meter.ts`) does five things around that callback:

1. Refuses when `AI_ENABLED=false` or the steward's `ai_enabled` flag is off
   (`AiDisabledError`, HTTP 503).
2. Resolves the workspace plan (`lib/plans.ts`; `SELF_HOSTED=true` is unlimited).
3. Reserves the feature's credit price (`CREDIT_COSTS`: filter 1, ask 2, draft 2,
   fit 5, research 10) through `getfunded.reserve_credits()`, which raises
   `quota_exceeded` when the monthly or daily cap would be crossed
   (`QuotaExceededError`, HTTP 402 with `upgradeUrl`).
4. Runs the callback with the one `AiClient` (live, `AI_MODE=mock`, or disabled).
5. Settles the ledger row with the real tokens, model and latency, or refunds it
   when the callback threw. A validation failure after the one retry therefore
   costs the workspace nothing.

The route handlers under `app/api/ai/*` never touch the ledger. Each one is
`aiRoute(req, feature, handler)` (`lib/ai/route.ts`): same origin, signed in,
active workspace, `can(plan, feature)`, body parsed with the zod schema from
`lib/ai/api-schemas.ts` through `boundedJson`, and every typed error turned into
`{ error: { code, message, ... } }` by `lib/ai/http.ts`. "Ask" streams server-sent
events (`lib/ai/sse.ts`, `lib/ai/ask-stream.ts`); a failure before the first
event is still an ordinary JSON error with a status.

`AI_MODE=mock` swaps the live client for a deterministic, token-free one. Mock
output is stored with `is_mock = true` in its own namespace and is never handed
to a real request; the UI labels it "Mock model".

## 2. Evidence citation: no claim without an id

A model in this app reasons only from an **evidence package**
(`lib/ai/evidence.ts`): a list of short items, each with an exact-copyable id
such as `grant_3`, `posture_1` or `applicant_profile`, a class (`source` =
verified from public filings, `yours` = the workspace's own profile and approved
knowledge) and a source label for the chip. The package is built server-side
from the corpus plane (read-only) and the workspace plane (under RLS); nothing a
member typed enters a prompt unless it is the profile or a knowledge row with
`approved = true`.

The model answers through a forced tool call whose schema requires
`evidenceIds` on every reason, dimension, concern and suggested ask
(`fit-schema.ts`), on every claim in a polished draft (`draft-schema.ts`), and
the structured dossier keeps a sources list (`research-schema.ts`). After zod,
`validateFitRefs()` / `draftProblems()` check every cited id against the package
(`packageIds`, `unknownRefs`). One retry names the exact violations; a second
failure throws `AiOutputRejectedError` and the credits are refunded. Nothing
unvalidated is ever stored.

What is stored (`getfunded.ai_analyses`, append-only) is the package itself
(`evidence`), the validated output (`output`), the composite score computed by
`composeScore()` from the seven dimension scores (the model never does that
arithmetic), and `input_fingerprint`: a hash of every item plus the prompt,
weights and model versions. The panel compares that hash with a freshly built
package to say "Data changed since this ran" without spending credits, and a
re-run with an unchanged fingerprint is reused for free.

In the UI (`components/ai/*`) every reason renders its ids as chips
(`EvidenceChips`): a teal `SourceChip` for a filing fact, a green Yours badge
for the workspace's own data, each opening the item's text and linking to its
row in the panel's evidence list. All of it sits inside `AiCard` or carries
`AiBadge`, so a reader always knows which words a model wrote and which rows a
filing holds.

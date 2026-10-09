# Plans, credits, and cost control

GetFunded is free to self-install. The hosted service at getfunded.ai runs the same code with
plan limits so that free use stays affordable for the steward and paid use funds the project.

This file is the single source of truth for plan limits. The web app reads these values from
`apps/web/lib/plans.ts`, which must match this table. A change here is a change there.

## The five plans

| Plan | Price | Members | AI credits / month | Saved funders | Pipelines | Export | Outreach |
|---|---|---|---|---|---|---|---|
| Free | $0 | 1 | 25 | 50 | 1 | 100 rows CSV | Drafts only (uses credits) |
| Starter | $10 / month | 1 | 150 | 500 | 3 | Full CSV | Drafts only |
| Pro | $20 / month | 3 | 500 | Unlimited | Unlimited | Full CSV + reports | Drafts + send through your own Gmail, each message approved by you |
| Team | $100 / month | 10 | 3,000 (pooled) | Unlimited | Unlimited | Full CSV + reports + API | Everything in Pro + shared knowledge base + follow-ups that stop when a funder replies |
| Enterprise | $1,500 / month | Unlimited | 25,000 (pooled) | Unlimited | Unlimited | Everything | Dedicated outreach: managed campaigns, sender domains and warm-up, deliverability monitoring, onboarding, SLA |

Every plan includes funder search, funder profiles with provenance, and application posture.
Search never costs credits. Only calls to a language model cost credits.

Every plan also includes **funder signals**: a funder's own dated announcements (a new capital
commitment, a program launch, an open call, a deadline) on its profile, and an in-app alert when a
funder on your saved list announces something. **Discovery alerts**, for funders you have not saved
whose announcement says nonprofits are eligible and matches your program areas, are on Starter and
above (and on every self-install). Signals are read from the corpus; classifying them is a pipeline
cost borne once, so they never use a workspace's credits. See docs/FUNDER-SIGNALS.md.

## What a credit buys

One credit is about 4,000 input tokens plus 1,000 output tokens on a mid-size model. The
app records real token counts on every call, so the credit price of a feature can be tuned
without a schema change.

| Feature | Credits | What happens |
|---|---|---|
| Natural-language search filter | 1 | The model turns a sentence into search chips |
| Ask the analyst (one question) | 2 | The model writes one read-only SQL query and explains the result |
| Outreach draft polish | 2 | The model rewrites a template using dossier facts only |
| Fit analysis (one funder) | 5 | Evidence package in, scored and cited analysis out |
| Research dossier (one funder, with web search) | 10 | Web search plus a structured, sourced dossier |

## How limits are enforced

1. Every model call goes through one server function, `meter()`, in `apps/web/lib/billing/meter.ts`.
   Nothing else may import the Anthropic SDK.
2. `meter()` reserves credits in `getfunded.usage_ledger` inside a transaction before the call,
   records the real token counts after it, and refunds the reservation if the call fails.
3. The monthly period starts on the workspace's billing anchor day. Free workspaces reset on the
   first of the month.
4. When a workspace reaches its limit the call is refused with a clear message and an upgrade link.
   There is no silent overage.
5. A daily soft cap of one third of the monthly credits spreads use across the month and limits
   the damage from a runaway script. Team and Enterprise can turn the daily cap off.
6. Anonymous search (no account) is rate limited to 30 requests per minute per IP address in
   Postgres (`getfunded.rate_limits`). Signed-in search is limited to 120 per minute per user.
7. A kill switch, `AI_ENABLED=false`, disables all model calls for everyone and shows a notice.

## Billing

- Stripe Checkout for subscriptions, Stripe Customer Portal for changes and cancellation.
- Plan changes take effect at once. The new plan's monthly allowance applies from the next request; unused credits do not carry over between plans.
- Webhooks update `getfunded.subscriptions`; the app never trusts the browser for plan state.
- Self-installs have no billing. The `SELF_HOSTED=true` setting puts every workspace on an
  "Unlimited" internal plan with the host's own API key and no meter stop (usage is still recorded).

## Why these numbers

Free gives a small nonprofit about five fit analyses or two research dossiers a month at a cost
to the steward of well under one dollar. Starter and Pro cover a solo development director.
Team covers a fundraising team. Enterprise pays for a person's time, not just compute.

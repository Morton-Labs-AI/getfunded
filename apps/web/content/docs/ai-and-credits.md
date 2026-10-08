---
title: AI and credits
description: What the AI tools do, what they never do, and how credits work.
group: nonprofits
order: 4
---

# AI and credits

GetFunded uses a language model for a few specific jobs. Each job costs credits. Search never costs credits.

## What the AI tools do

| Tool | What it does | Credits |
|---|---|---|
| Natural-language filter | Turns a sentence into search filter chips | {{credits.filter}} |
| Ask the analyst | Writes one read-only database query to answer your question, and explains the result | {{credits.ask}} |
| Outreach draft polish | Rewrites your template using facts from the funder's record only | {{credits.draft}} |
| Fit analysis | Reads the funder's filings and your organization profile, then scores and explains fit | {{credits.fit}} |
| Research on the web | Searches the public web and writes a report on one funder, with every source listed | {{credits.research}} |

## What the AI tools never do

- **They never invent a fact.** Every statement in a fit analysis cites an evidence id from the package the model was given. You can click each one. Every section of a web research report lists the pages it came from.
- **They never claim a funder is interested in you.** An analysis says how the record compares with your profile. It does not predict a decision.
- **They never write to the database.** "Ask the analyst" runs on a read-only database role with a time limit.
- **They never see other workspaces.** The model gets your profile, the funder's public record, and your approved facts. Nothing else.
- **They never send email.** Drafts wait for you to approve them. See [Outreach](/docs/outreach).

Everything a model produces is shown inside a violet, dashed box with the word "AI". You can accept it, edit it, or dismiss it. Your verdict is recorded.

## What a credit is

One credit is about 4,000 input tokens and 1,000 output tokens on a mid-size model. A token is about three quarters of a word. The app records the real token counts on every call, so the price of each tool can change without surprising you.

## Monthly and daily limits

| Plan | Credits per month | Most credits in one day |
|---|---|---|
| Free | {{plans.free.monthly_credits}} | {{plans.free.daily_credits}} |
| Starter | {{plans.starter.monthly_credits}} | {{plans.starter.daily_credits}} |
| Pro | {{plans.pro.monthly_credits}} | {{plans.pro.daily_credits}} |
| Team | {{plans.team.monthly_credits}} pooled | {{plans.team.daily_credits}} (can be turned off) |
| Enterprise | {{plans.enterprise.monthly_credits}} pooled | {{plans.enterprise.daily_credits}} (can be turned off) |

The daily limit is one third of the monthly amount. It spreads use across the month and limits the damage from a runaway script. Team and Enterprise can turn it off in settings.

Current limits are always on [Pricing](/pricing). The usage meter in your workspace shows what you have used this period.

## What happens at the limit

When a call would cross your monthly or daily limit, it is refused with a clear message and a link to upgrade. There is no silent overage and no surprise bill.

Credits reset on your billing day. Free workspaces reset on the first of the month. If you change plan, the new plan's allowance applies from your next request; unused credits do not carry over.

## How metering works

Every model call goes through one function in the server. It:

1. reserves the credits inside a database transaction,
2. runs the model,
3. records the real token counts,
4. keeps the charge if the call failed after the model had already read or written tokens (the model bills us for them either way), and refunds the reservation only when nothing was spent, for example when the model never answered.

If the model is turned off for everyone (for example during an incident), every AI button shows a notice and nothing is charged.

## Who processes the text

Model calls are made to Anthropic's API. We send the funder's public record, your organization profile, your approved facts and your question. We do not send your contacts or your email. See [Security and privacy](/docs/security-and-privacy).

## Self-install

If you run GetFunded yourself, you use your own Anthropic API key and there is no credit limit. Usage is still recorded so you can see your own costs. See [Self-install](/docs/self-install).

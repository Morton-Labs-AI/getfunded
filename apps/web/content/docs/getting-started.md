---
title: Getting started
description: Search for funders in one minute, then create a free account to save what you find.
group: nonprofits
order: 1
---

# Getting started

GetFunded helps you find the foundations and other funders that already fund work like yours. It is built from public records: IRS Form 990 and 990-PF filings, the IRS exempt-organization master file, SEC filings and SBIR awards. Every fact shows where it came from.

You do not need an account to search. You need a free account to save funders and to use the AI tools.

## Step 1: Search without an account

1. Go to [Search](/search).
2. Type what your organization does. For example: "after-school tutoring in Ohio".
3. Press Enter.

You get a list of funders. Each row shows the funder's name, where it is, what kind of funder it is, and whether its filings say it accepts applications.

You can also type a funder's name or EIN to find one funder.

Search never costs anything. It is free for everyone, with or without an account.

## Step 2: Read a funder profile

Click a funder to open its profile. The profile shows:

- **Application posture.** "Accepts applications", "Funds preselected organizations only" or "Not stated in filings". See [Funder profiles](/docs/funder-profiles) for what each one means.
- **How to apply**, when the filing includes it.
- **Money.** Assets, revenue, grants paid, by year.
- **Grants paid**, with the recipients and the purpose, as reported.
- **Officers and trustees**, as reported on the filing.
- **A source line on every fact.** Click it to see the dataset, the filing year, a link to the filing and, when we have it, the fingerprint of the file we read.

## Step 3: Create a free account

1. Click **Start free**.
2. Enter your name and email. There is no password.
3. Open the email we send you and click the link, or type the 6-digit code.
4. Tell us a little about your organization. This helps the AI tools judge fit. You can skip this and come back later.

The free plan includes unlimited search, {{plans.free.saved_funders_limit}} saved funders and {{plans.free.monthly_credits}} AI credits each month. See [Pricing](/pricing).

## Step 4: Save funders and work the list

With an account you can:

1. **Save** a funder from search or from its profile.
2. **Move it through a pipeline**: identified, researching, qualified, cultivating, submitted, awarded.
3. **Add tasks and notes.**
4. **Ask the AI** to explain fit, build a research dossier or polish an outreach draft. Each of these uses credits. See [AI and credits](/docs/ai-and-credits).

See [Workspace](/docs/workspace) for the details.

## Three kinds of information

Everything on a funder page is one of three kinds. Each kind looks different, so you always know what you are reading.

| Kind | What it means | How it looks |
|---|---|---|
| Source | Verified from a public filing | Teal, dotted underline, a document icon |
| AI | Suggested by a model. Never a fact. | Violet, dashed border, the word "AI" |
| Yours | Your own notes, tags and stages | Green, solid left rule |

## For developers and AI agents

GetFunded is open source (Apache-2.0) and the dataset is open (CC BY 4.0). You can run the whole thing yourself.

```bash
git clone https://github.com/Morton-Labs-AI/getfunded
cd getfunded
```

Then follow [Self-install](/docs/self-install). The short version is three commands: build the database, create the app role, run the web app.

If you are an AI coding agent, start with these files in the repository:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `apps/web/AGENTS.md`

A good first prompt for an agent is on the [home page](/#agents).

Team and Enterprise plans include an API. See [API](/docs/api).

---
title: Workspace
description: Saved funders, the pipeline, tasks, notes and CSV import.
group: nonprofits
order: 5
---

# Workspace

Your workspace is where your own work lives: the funders you saved, the stage each one is in, your tasks and notes. Everything here is yours. It is shown in green with a solid left rule, so it never looks like a fact from a filing.

## Your organization profile

The first time you sign in we ask about your organization: mission, state, counties, program areas, budget, who you serve. The AI tools read this profile when they judge fit. You can change it any time in **Settings → Organization**.

## Saved funders

Save a funder from search or from its profile. A saved funder keeps:

- a snapshot of the name, EIN, type, city and state, so your list survives data refreshes,
- a **stage** (below),
- a **tier** from 1 to 3, your own priority,
- an **owner**, the team member working on it,
- an **ask amount**,
- a **next action** and its due date,
- **tags** and a note on why it is on the list.

Limits by plan: Free {{plans.free.saved_funders_limit}}, Starter {{plans.starter.saved_funders_limit}}, Pro and above unlimited. See [Pricing](/pricing).

## The pipeline

Each saved funder is in one stage:

| Stage | Meaning |
|---|---|
| Identified | On the list, not yet researched |
| Researching | You are reading the record |
| Qualified | Worth pursuing |
| Cultivating | You are building the relationship |
| LOI submitted | A letter of inquiry is in |
| Proposal submitted | A full proposal is in |
| Awarded | Funded |
| Declined | Not funded this time |
| Parked | On hold |

Drag a card between columns, or change the stage on the funder page. Every move is recorded with who made it and when. If two people change the same funder at the same time, the second one sees a notice and can retry, so nothing is lost.

## Tasks

A task has a title, details, a due date and an assignee. It can be attached to a funder or stand alone. Tasks appear on your dashboard in due-date order.

## Notes and activity

Each saved funder has an activity log: notes, calls, meetings, emails you record, and system entries such as "imported from CSV" or "AI analysis accepted". The log is append-only. Nothing in it can be edited after the fact, so it is a reliable history.

## Approved facts

Pro and above can keep a small knowledge base: facts about your organization, program descriptions, outcomes and boilerplate. Only facts marked **approved** are ever given to the AI when it drafts outreach. This keeps drafts grounded in what you have checked.

## Import a CSV

If you already have a list of funders in a spreadsheet:

1. Go to **Saved funders → Import**.
2. Upload a CSV. The file needs a name column. An EIN column helps a lot.
3. We match each row to the database by EIN first, then by name and state.
4. You get a report: matched, unmatched and possible duplicates. Nothing is merged without you seeing it.

Unmatched rows are kept in the report so you can fix the spreadsheet and try again.

## Export

- Free: 100 rows as CSV.
- Starter and above: full CSV.
- Pro and above: reports.
- Team and above: the API. See [API](/docs/api).

Every export labels AI output as AI, the same as the screen.

## Members

Pro workspaces can have {{plans.pro.members}} members, Team {{plans.team.members}}, Enterprise {{plans.enterprise.members}}. Invite someone from **Settings → Members**. Invites expire. Roles are owner, admin and member; only owners and admins manage members and billing.

---
title: Search guide
description: The two search modes, the filters, what "application posture" means, and the IRS standing filter.
group: nonprofits
order: 2
---

# Search guide

Search is free. It does not need an account and it never uses AI credits.

## Two ways to search

### 1. By name or EIN

Type part of a funder's name, or its 9-digit EIN. This works for every organization in the database, including public charities.

- "Community Foundation of" finds every community foundation with that phrase in its name.
- "12-3456789" finds the one organization with that EIN.

Name search matches names and titles only. A topic word like "youth" will also match organizations that have "youth" in their name, whether or not they fund youth work. For topics, use the second mode.

### 2. By what the funder funds

Type a sentence about your work. For example: "mobile dental clinics for rural families".

Search reads the funder's own filings: the purpose of each grant it paid, what it says about its program, and where it gives. It finds funders whose record looks like your work, even when they never use your words.

This mode reads giving records, so it covers private foundations, companies, federal programs, and the public charities that report the grants they make (Schedule I of Form 990). A public charity that reports no grants has no giving record to read; you can still find it by name or EIN.

When the semantic index is not available, search falls back to keywords and shows a notice.

## Filters

| Filter | What it does |
|---|---|
| Type | Private foundation, public charity, company, government agency |
| State | The funder's state, from its filing address |
| Application posture | See below |
| Size | Latest assets or latest grants paid |
| Focus area | The IRS category (NTEE major group) from the IRS master file, the IRS's list of tax-exempt organizations |
| IRS standing | "Any" (the default) or "Hide automatically revoked". See [The IRS standing filter](#the-irs-standing-filter) |

Filters change the URL, so you can share or bookmark a search.

## What "application posture" means

A private foundation's Form 990-PF has a section called Part XV. It asks the foundation to say how to apply, or to check a box that says it only gives to organizations it chooses itself.

We read that section and show one of three values:

| Value | Meaning |
|---|---|
| **Accepts applications** | The latest parsed filing has an application block in Part XV. The profile shows what it says. |
| **Funds preselected organizations only** | The filing checks the "pre-selected" box. Unsolicited applications are not invited. |
| **Not stated in filings** | The filing has no Part XV statement at all. |

**"Not stated" is not "closed."** Form 990 (the form public charities file) has no Part XV. So every grantmaking public charity, and many foundations, show "Not stated in filings". They may well accept applications. Look at the website or call.

We never show the word "closed". A missing statement is not a closed door.

## The IRS standing filter

The **IRS standing** filter has two choices.

| Choice | What it does |
|---|---|
| **Any** | Hides nothing. This is the default. |
| **Hide automatically revoked** | Leaves out organizations that the IRS automatically revoked. |

An organization is left out only when all three of these are true:

1. It is on the IRS Automatic Revocation of Exemption List. The IRS puts an organization on that list when it files no annual return or notice for three years in a row. The list holds no other kind of revocation.
2. The list shows no reinstatement after that revocation.
3. It is on no other IRS list we hold (the IRS master file and IRS Publication 78 data).

The filter keeps these organizations in your results:

- organizations where the IRS lists disagree. The profile shows both facts.
- organizations that were revoked once and are recognized again.
- organizations that are on none of the IRS lists. Being on no list is not a finding.
- companies and agencies. The IRS lists do not cover them.

When you do not use the filter, nothing is hidden. A result that the IRS automatically revoked shows a chip that says so. Click the chip to read the IRS statement and the date of the list it came from.

Two things to know:

- Search ranks a limited set of top matches for each search. The filter removes the automatically revoked organizations from that set, so the count can go down by the number that was removed.
- The lists have a date. The IRS replaces them about once a month. See [IRS standing](/docs/funder-profiles#irs-standing) for how to read a standing.

In a link, the filter is `standing=hide_revoked`. The [API](/docs/api) takes the same parameter.

## Natural-language filters (signed in)

With an account you can type a sentence like "foundations in Texas that accept applications and gave more than a million dollars last year". The AI turns it into filter chips. You see the chips before you search and can change them. This costs {{credits.filter}} credit. See [AI and credits](/docs/ai-and-credits).

## Limits you should know

- Search is rate limited: 30 searches a minute without an account, 120 a minute with one.
- The "Gives per year" filter and the "Most giving" sort read the giving lines of Form 990-PF (qualifying distributions, else charitable disbursements), so in name, EIN and browse searches they cover private foundations only. Describe-the-work search also counts a public charity's reported grants, averaged per year, so grantmaking charities are not dropped there. On a profile, a public charity's "Grants paid" comes from its Form 990, and grant lists include Schedule I grants from public charities as well as 990-PF grants.
- At any time, tens of thousands of filed returns have not yet been published by the IRS. They appear with no detail until the IRS publishes them.
- See [Data sources and license](/docs/data-sources-and-license) for the full list of known limits.

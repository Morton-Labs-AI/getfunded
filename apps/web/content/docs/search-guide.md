---
title: Search guide
description: The two search modes, tuning results for your organization, the filters, what "application posture" means, and the IRS standing filter.
group: nonprofits
order: 2
---

# Search guide

Search is free. It does not need an account and it never uses AI credits.

## Two ways to search

### 1. By what the funder funds

Type a few words or a sentence about your work. For example: "literacy", "food bank", or "mobile dental clinics for rural families in Kentucky".

Search reads the funder's own filings: the purpose of each grant it paid, who received it, what it says about its program, and where it gives. It finds funders whose record looks like your work, even when they never use your words. "Food bank" finds funders of food banks, not organizations named food bank.

A place in your words ("in Ohio", "Boise", "Denver, CO") ranks funders that give there first. It does not hide the others.

This mode reads giving records, so it covers private foundations and the public charities that report the grants they make (Schedule I of Form 990). A public charity that reports no grants has no giving record to read; you can still find it by name or EIN. Companies and federal programs show when you choose that type.

When the semantic index is slow or not available, search falls back to keywords and shows a notice.

### 2. By name or EIN

Type a funder's name, or its 9-digit EIN. A few words that read like a name ("Ford Foundation", "Lilly Endowment") go straight to the name lookup, and so does anything in quotes. When several funders share a name, the one that gives most comes first.

- "Silicon Valley Community Foundation" finds that funder first.
- "12-3456789" finds the one organization with that EIN.

When a short topic is also a funder's name ("Kresge"), the results start with a line naming those funders.

## Tune results for your organization

Tell search where you work, what you do and your budget ("Tune results" above the filters, or your organization profile once you sign in). Funders that have paid grants in your state and to groups like yours rank first, and each result says why with facts from its filings:

- "14 grants in Ohio, FY2021–2025"
- "Gives most in Ohio" or "Ohio is among its top recipient states"
- "Median grant $12,500 (140 grants, FY2021–2025)"

Tuning changes the order, never who can appear. A national funder that fits your words still shows. In the app, "Ignore my profile" turns tuning off for one search.

## Filters

| Filter | What it does |
|---|---|
| Type | Private foundation, public charity, company, government agency |
| Gives in | Funders whose filings show grants paid to organizations in that state in the last five fiscal years |
| Funds this cause | Funders whose filings show grants paid to organizations in that IRS category (NTEE major group) in the last five fiscal years. Not every grant names a recipient we can classify |
| Based in | The funder's own state, from its filing address. Many funders give beyond it |
| Application posture | See below |
| Size | Latest assets or latest grants paid |
| Funder's own category | The funder's own IRS category (NTEE major group) from the IRS master file. Most private foundations are listed as grantmakers or have no category, so this is rarely what you want; use Funds this cause |
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
| **Hide automatically revoked** | Leaves out organizations that the IRS automatically revoked. Revoked organizations that still file returns stay in the results. |

An organization is left out only when all four of these are true:

1. It is on the IRS Automatic Revocation of Exemption List. The IRS puts an organization on that list when it files no annual return or notice for three years in a row. The list holds no other kind of revocation.
2. The list shows no reinstatement on or after the date of that revocation.
3. No other IRS list we hold speaks for it. IRS Publication 78 data does not list it. It is also not in the IRS master file, or our copy of the master file is older than the day the IRS posted the revocation. An older copy still names the organization only because it is older, so we follow the newer IRS list.
4. We hold no return that it filed for a tax year after the revocation date.

The filter keeps these organizations in your results:

- revoked organizations that still file returns. When we hold a return for a tax year after the revocation date, the organization stays in the results. It is still on the IRS list as revoked, and its chip says "returns on file for later years". An organization that loses its tax-exempt status must still file, so a later return does not show that the IRS reinstated it.
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

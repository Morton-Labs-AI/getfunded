---
title: Funder profiles
description: How to read a funder page, what each section of a 990 means, and how provenance works.
group: nonprofits
order: 3
---

# Funder profiles

A funder profile is a structured reading of the funder's own public filings. It does not add opinion. When a filing does not say something, the profile says so.

## The header

- **Name, city, state** from the IRS master file (the IRS Exempt Organizations Business Master File, the IRS's list of every tax-exempt organization).
- **EIN**, the funder's tax id, shown as 12-3456789.
- **Type**: private foundation, public charity, company, adviser, fund or agency.
- **Website**, when the funder wrote one on its filing.
- **Application posture**: "Accepts applications", "Funds preselected organizations only" or "Not stated in filings". See the [Search guide](/docs/search-guide#what-application-posture-means).

## How to apply

Private foundations report this in Part XV of Form 990-PF. When it is there, you see:

- the contact name and mailing address the foundation gave,
- the form and information it asks for,
- submission deadlines,
- restrictions and limits on awards.

We show the text as filed. We do not rewrite it.

Email addresses and phone numbers appear only when the record is a role inbox, such as grants@, that the filer published and that the record allows us to show. Named people's addresses are never shown.

## Money

Money comes from the latest filing that the IRS has published and we have parsed, with a year-by-year series below it.

| Line | What it means |
|---|---|
| Total assets | What the funder held at the end of the year |
| Total revenue | Money that came in during the year |
| Grants paid | What a private foundation gave in grants that year |
| Qualifying distributions | Grants plus related spending that counts toward the foundation's required payout |
| Contributions received | Gifts into the funder that year |

Rules we keep:

- A missing line reads **"Not available"**. It never reads "$0". A real zero reads "$0".
- Amended filings replace the original. You see the latest version. The older one is kept, marked superseded, and never double-counted.
- Numbers are shown as filed. Filers make mistakes. We do not correct them.

## Grants paid

Each row is one grant from the funder's filing: the recipient as written, the city and state, the purpose text, the amount and the year. Where we could match the recipient to an organization by EIN, the row links to it. The count in the header ("N grants on file"), the table, the "What they fund" panel and the AI fit analysis all count the same rows: grants paid, leaving out any row from a filing that a later amended return replaced.

Public charities report grants on Schedule I of Form 990. Private foundations report them in Part XV of Form 990-PF. Both appear here.

## Officers and trustees

Names, titles and compensation as reported on the filing. Corporate trustees are listed separately from people.

## Similar funders

A list of funders whose filings look like this one. It is computed from the text of the filings. It is a lead, not a fact.

## Provenance: the source line

Every fact on the page carries a source line. Click it to see:

1. **The dataset.** For example "IRS 990-PF e-file".
2. **The filing year.**
3. **The file fingerprint**, when we have it: the first characters of the sha256 hash of the exact file we read. Facts that come from a filing carry it; the identity line from the IRS master file and the public contact channels do not, and the source line then leaves it out rather than showing a blank.
4. **A link** to the filing or dataset, when one exists.

This is the same chain the database keeps: dataset → source URL → hashed file → ingestion run → row. Anyone can download the same file, hash it, and check. See [Data sources and license](/docs/data-sources-and-license).

## When something looks wrong

Funder data comes from government filings. We publish what the filing says. If a profile looks wrong:

1. Open a [data correction issue](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml).
2. Give the funder name, the EIN, the profile link, what is wrong, and what you checked.

We trace the fact to its file and either fix our parser, load a newer filing, or leave the fact as filed with a note. We never edit a fact by hand to differ from the source.

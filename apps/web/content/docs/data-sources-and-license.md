---
title: Data sources and license
description: Where every fact comes from, what we never republish, the known limits, and the CC BY 4.0 terms.
group: developers
order: 3
---

# Data sources and license

Every fact in GetFunded comes from a public government record. Every published fact row carries the sha256 hash of the file it was parsed from and a locator for the exact record inside that file.

## Sources

| Source | Publisher | What we take | Terms |
|---|---|---|---|
| Form 990 / 990-PF e-file index and XML | Internal Revenue Service | Filings spine; 990-PF officers, grants paid, financial lines, Schedule B, Part XV application info; Form 990 Schedule I grants, core financials, Part IX split, Part VII compensation; filer-stated websites | US government work, public domain |
| Exempt Organizations Business Master File | Internal Revenue Service | Organization identity: name, EIN, address, subsection, foundation code, NTEE code, ruling date, asset/income/revenue amounts | Public domain |
| Automatic Revocation of Exemption List | Internal Revenue Service | Per EIN: revocation date, the date the IRS posted it, and the reinstatement date when there is one. Automatic revocations only (no return or notice filed for three years in a row) | Public domain |
| Publication 78 data | Internal Revenue Service | Per EIN: the IRS deductibility codes (the class of organization for tax-deductible gifts) | Public domain |
| Form ADV (IAPD) | US Securities and Exchange Commission | Adviser identity, CRD and SEC file numbers, offices, assets under management, private-fund schedules | Public domain |
| Form D | US Securities and Exchange Commission | Exempt-offering notices: issuer, offering amounts, related persons as filed | Public domain |
| SBIR/STTR awards | US Small Business Administration | Award records: agency, program, phase, amount, awardee | Public domain |
| ZCTA crosswalk | US Census Bureau | ZIP-to-ZCTA geography crosswalk used to normalize places | Public domain |
| Federal agencies and programs | This project | 10 agencies and 16 non-dilutive federal programs, curated | CC BY 4.0 |
| Entity-resolution labels | This project | Human match / not-match decisions | CC BY 4.0 |

URLs, cache rules and the limits of each source are in [corpus/docs/DATA-SOURCES.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/corpus/docs/DATA-SOURCES.md).

## What we never republish

- **Contact channels** appear only when the record carries `publishability = 'public'` and is not in the `red` privacy tier. Role inboxes such as grants@ can be public. A named person's address is withheld by policy.
- **Vendor-sourced facts** are never republished. A database trigger makes it impossible to mark them public.
- **Facts scraped from funder websites** are never republished. They may be used internally to check public records, only when a human approves.

The rule is structural: every public view joins the file's license, and a row from a non-republishable file cannot appear in a public view whatever its other columns say.

## The provenance chain

```
dataset name → source URL → sha256-hashed immutable file → licence code
            → ingestion-ledger run → row (raw_file_id + source_record_locator)
```

- `raw_files` has one row per distinct file, keyed by sha256, with three separate timestamps: when we fetched it, the publisher's last-modified date, and when we last parsed it. A re-parse can never make old data look fresh.
- Record locators look like `row:EIN=742961304` for a CSV row, or an element path inside the 990 XML for a filing value.
- A published export is byte-identical on re-run, and its manifest lists the hash of every file.

Full description: [corpus/docs/PROVENANCE.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/corpus/docs/PROVENANCE.md).

## Three doctrines the data obeys

1. **Unknown is not closed.** Application posture is `open`, `preselected_only` or `unknown`. `unknown` means the return carries no Part XV statement. No view, export or ranking may treat it as a refusal.
2. **Missing is not $0.** `NULL` means the line is absent from the return. `0` means the filer reported zero. The two are never coalesced.
3. **Superseded filings are filtered.** An amended return gets a new object id. Within one (EIN, return type, tax period) the greatest object id is the live filing. Losers keep their detail rows but lose their funding events, so nothing is double-counted.

## Known limits

- **Entity resolution is not applied.** Records of the same fund from different SEC sources are separate organizations. People are per-source. `people` and `relationships` stay out of the export until resolution certifies.
- **Not ingested:** 990-EZ, 990-N, 990-T, paper returns and determination letters.
- **IRS standing has a date and a narrow meaning.** It is read from the IRS master file, Publication 78 data and the Automatic Revocation of Exemption List, each as of the date shown with it. The revocation list holds automatic revocations only; an organization that lost its status in another way is not on it.
- **Grants-paid totals are 990-PF only.** Giving-ranked views cover private foundations.
- **The IRS backlog.** At any time tens of thousands of indexed returns have no published XML. They sit in the filings spine with nothing attached until a later run.
- **Back-year 990-PF grant rows** are loaded for the newest index years only.
- **Form D** names the issuer, never the investors. It is not a deal graph.
- **Inside parsed 990-PFs**, Schedule B is present on about a quarter of filings, and Part XV application information is actionable on about a quarter; most of the rest state only that the foundation funds preselected organizations.
- **Keyword search matches names and titles only.** Semantic search needs the optional embedding step.
- **Filers make mistakes.** We publish filings as filed. Out-of-range numbers are clamped to `NULL`, not corrected.

## License

The dataset is published under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0). It covers our compilation: the selection, cleaning, linking, normalization, evidence ids and arrangement we add. It does not cover the underlying government records, which are public domain. You may use the raw records freely without crediting us.

When you share or reuse the dataset, credit it like this:

> Data from GetFunded, Open Funder Database (https://getfunded.ai), licensed CC BY 4.0. Derived from IRS, SEC, SBA, and US Census public records.

Keep a link to the license. If you change the data, say so.

The code is [Apache-2.0](https://github.com/Morton-Labs-AI/getfunded/blob/main/LICENSE). The name and logo are trademarks of Morton Labs; see [TRADEMARK.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/TRADEMARK.md).

## Accuracy and corrections

We publish filings as the government published them. Filings can be late, amended or wrong. We filter superseded filings, but we do not correct the record.

If you find an error, open a [data correction issue](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml) with the funder name, the EIN, the profile link, what is wrong and what you checked.

## No warranty

The dataset is provided "as is", without warranty of any kind. See section 5 of the CC BY 4.0 legal code.

# Data License

The GetFunded dataset (the "Open Funder Database") is published under the
**Creative Commons Attribution 4.0 International** license (CC BY 4.0).
Full text: https://creativecommons.org/licenses/by/4.0/legalcode

This file covers the data. The code is covered by [LICENSE](LICENSE)
(Apache-2.0). The name and logo are covered by [TRADEMARK.md](TRADEMARK.md).

## What CC BY 4.0 covers here

CC BY 4.0 applies to **our compilation**: the selection, cleaning, linking,
normalization, entity resolution, evidence ids, and arrangement that we add.

It does **not** apply to the underlying government records. Those are works
of the United States government and are in the public domain
(17 U.S.C. § 105). You may use the raw records freely without crediting us.

## Scope

The dataset contains facts derived only from US-government public-domain
sources:

- IRS Tax Exempt Organization Search and e-file XML bulk data
  (Form 990, Form 990-PF, Schedule I)
- IRS Exempt Organizations Business Master File (BMF)
- IRS Automatic Revocation of Exemption List and IRS Publication 78 data
  (Tax Exempt Organization Search bulk data)
- SEC Investment Adviser Public Disclosure (IAPD) Form ADV
- SEC Form D
- SBIR.gov award data (SBIR and STTR)
- US Census Bureau ZIP Code Tabulation Area (ZCTA) crosswalk

## Attribution

When you share or reuse the dataset, credit us like this:

> Data from GetFunded, Open Funder Database (https://getfunded.ai),
> licensed CC BY 4.0. Derived from IRS, SEC, SBA, and US Census public
> records.

Keep a link to this file or to the CC BY 4.0 license. If you change the
data, say so.

## Sources

| Source | Publisher | Terms | What we republish |
|---|---|---|---|
| Form 990 / 990-PF e-file XML bulk data; Tax Exempt Organization Search | Internal Revenue Service | US government work, public domain | Filing-level financial figures, officers and trustees as reported, grants made (990-PF Part XV, 990 Schedule I), application-posture statements, filing identifiers |
| Exempt Organizations Business Master File | Internal Revenue Service | US government work, public domain | Organization identity: name, EIN, address, subsection, NTEE code, ruling date, deductibility status |
| Automatic Revocation of Exemption List | Internal Revenue Service | US government work, public domain | Per EIN: legal name, exemption type, revocation date as filed and as corrected by the IRS note for 2020, revocation posting date, reinstatement date; and the standing we derive from the lists |
| Publication 78 data | Internal Revenue Service | US government work, public domain | Per EIN: deductibility status codes (the class of organization for deductible gifts) |
| Form ADV (IAPD) | US Securities and Exchange Commission | US government work, public domain | Adviser identity, CRD and SEC file numbers, offices, assets under management, private-fund schedules |
| Form D | US Securities and Exchange Commission | US government work, public domain | Exempt-offering notices: issuer, offering amounts, related persons as filed |
| SBIR/STTR awards | US Small Business Administration (SBIR.gov) | US government work, public domain | Award records: agency, program, phase, amount, awardee |
| ZCTA crosswalk | US Census Bureau | US government work, public domain | ZIP-to-ZCTA and geography crosswalk used to normalize places |

## What we never republish

- **Contact channels** (email, phone, web forms) appear only when the
  record carries `publishability = 'public'`. Everything else stays private.
- **Vendor-sourced facts** (paid enrichment, licensed databases) are never
  republished. A database trigger makes it impossible to mark them public.
- **Facts scraped from funder websites** are never republished. They may be
  used internally to check public records, and only when a human approves.

Every published fact row carries the hash of its source file and a record
locator, so you can trace it back to the government record.

## Accuracy

We publish filings as the government published them. Filings can be late,
amended, or wrong. We filter superseded (amended) filings, but we do not
correct the record. When a fact is missing we say "Not available", not "$0".
When a filing does not state something we say "Not stated in filings".

If you find an error, open a
[data correction issue](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml).

## No warranty

The dataset is provided "as is", without warranty of any kind. See
section 5 of the CC BY 4.0 legal code.

---
title: Using the Open Foundation List
description: What the free foundation list is, how to open it in Excel or Google Sheets, how to read it honestly, and how to cite it.
group: nonprofits
order: 8
---

# Using the Open Foundation List

The Open Foundation List is a free list of every U.S. private foundation that files Form 990-PF electronically. For each foundation it shows what it gave, what it holds, and whether it says it accepts applications. It also lists the grants whose recipient we could match to an organization record.

You get the files from [the list page](/foundations). You may reuse them when you credit the source.

## What it is

The list comes from the returns that private foundations file with the IRS. Those returns are public records. We read them, put the main facts in spreadsheet files, and publish the files.

| File | One row is | Use it to |
|---|---|---|
| `foundations.csv.gz` | One foundation | Build a list of foundations to look at: name, place, latest numbers, what it says about applications. |
| `foundation_years.csv.gz` | One foundation in one fiscal year | See how giving and assets changed from year to year, and how many of its grants are in the grants files. |
| `foundation_grants_2023.csv.gz` and one file for each other fiscal year | One grant to an organization we could match | See which organizations a foundation gave to, and how much. |

The meaning of every column is in the table on [the list page](/foundations#columns). That table is the only copy, so it always matches the files.

You do not need the files to look up a few foundations. [Search](/search) is free and shows one foundation at a time, with a link to each filing.

## Open the files in Excel or Google Sheets

A file that ends in `.csv.gz` is a spreadsheet file (`.csv`) that was packed to make it smaller (`.gz`). You open it in two parts. First unpack it. Then import it.

### Part 1: unpack the file

1. Download the file from [the list page](/foundations#downloads).
2. Unpack it:
   - **Mac:** double-click the file. A new file that ends in `.csv` appears next to it.
   - **Windows:** install the free program 7-Zip. Right-click the file, choose **7-Zip**, then **Extract Here**. On Windows 11 you may need to choose **Show more options** first.
3. Check that you now have a file that ends in `.csv`.

### Part 2 in Excel

1. Open a blank workbook.
2. On the **Data** tab, choose **From Text/CSV**. Select the `.csv` file.
3. In the preview window, choose **Transform Data**.
4. Select the `ein` column and the `zip` column. Set their data type to **Text**. In a grants file, do this for `funder_ein` and `recipient_ein`.
5. Choose **Close & Load**.

Do not skip step 4. Some EINs and ZIP codes start with a zero. If Excel reads them as numbers, it removes the zero, and the EIN no longer matches the IRS number.

Excel shows at most 1,048,576 rows on one sheet. Look at the row count on the download card before you open a file. If the file has more rows than that, keep only the rows you need in step 3 (for example, one state) before you load it.

### Part 2 in Google Sheets

1. Open a blank sheet.
2. Choose **File**, then **Import**, then **Upload**. Select the `.csv` file.
3. Clear the box **Convert text to numbers, dates, and formulas**. This keeps the zero at the start of an EIN or a ZIP code.
4. Choose **Import data**.

Google Sheets holds at most 10 million cells in one file. To count the cells, multiply the rows by the columns. A large file may not fit.

## Read it honestly

The list says what the returns say, and nothing more. Keep these four rules.

1. **`not_stated` does not mean closed.** It means the latest return says nothing about applications. That is a missing statement, not a refusal. Do not remove these foundations from your list as if they had said no.
2. **An empty cell means not available, never zero.** When a line is missing from the return, the cell is empty. A `0` in the file is a real zero that the foundation reported. Do not fill empty cells with 0 before you add numbers up.
3. **Amended returns replace the originals.** When a foundation files a corrected return for the same year, the list uses the newer one. Nothing is counted twice.
4. **Contact details are for shared inboxes and office phones only.** An email or a phone number appears only when the filing lists a shared inbox, such as grants@, or an office phone. A named person's address is left out. A contact is not an invitation. Check `application_posture` first: a foundation that funds preselected organizations only can still have a contact in the file.

## Read the grants files honestly

The grants files have three more rules.

1. **The grants files do not list every grant.** A foundation types the name of each recipient on its return. Some recipients are private people, such as a student with a scholarship. So a grant is listed only when we matched its recipient to an organization record. Every other grant is counted and is not named.
2. **Do not use a grants file as a total of giving.** The sum of a grants file is less than what the foundations gave. For the total, use `grants_paid` in `foundation_years.csv.gz`. In the same file, `grants_linked_on_file` and `grants_not_linked_on_file` show how many grants of each year are in the grants file and how many are not.
3. **A match can be wrong.** The recipient name, city and state come from the organization record we matched. They are not the text on the return. Use `filing_object_id` to find the return before you rely on a row.

If a row names a private person, tell us. Use the link in "Found a mistake?" below.

## What we leave out on purpose

The files are public and anyone may copy them. So three things are held back.

1. **The purpose of each grant.** A foundation writes the purpose in its own words, and those words can name a private person, such as a gift in memory of someone. The purpose is not in the files. You can read it on the foundation's page (the `profile_url` column, or [Search](/search)). A later release can add it after a privacy review.
2. **Contact details inside a deadline.** `application_deadline_text` is empty when the filed text holds an email address or a phone number.
3. **The "in care of" part of a name.** Some names on IRS records end with "C/O" or "%" and the name of a person, a bank or a firm. The files give the name without that part.

Each release counts the deadlines it made empty and the names it cut. The counts are in the release's `manifest.json`, under `withheld`.

## Check that your download is complete

This step is optional. Each download card shows a **file fingerprint**. It is a short code that changes if even one character of the file changes. The card shows the first 12 characters. The **Copy full fingerprint** button copies all of it.

To make the fingerprint of your own copy (a sha256 hash), run one command on the file you downloaded, before you unpack it:

- **Mac:** open Terminal and type `shasum -a 256 foundations.csv.gz`
- **Windows:** open Command Prompt and type `certutil -hashfile foundations.csv.gz SHA256`

If the result is the same as the full fingerprint, your file is complete and unchanged.

## How to cite

The list is published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). You may use it, share it and change it. You must credit the source. The license covers our work on the list: which records we chose, how we arranged them, and the columns we worked out from them. The facts come from public records. Facts are not subject to copyright, and the license does not restrict them.

1. Go to **How to cite** on [the list page](/foundations#downloads).
2. Choose **Copy citation**. The line names the source, the release, the release date, the page address and the license.
3. Paste the line where you use the data. If you changed the data, say so.

## How often it is refreshed

The list is refreshed when a new release is published. The release date and the years covered are on [the list page](/foundations#downloads).

## Found a mistake?

We publish returns as they were filed, and filers make mistakes. If a row looks wrong, open a [data correction issue](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml). Give the foundation's name, its EIN, and what you checked. You need a free GitHub account.

## For developers and AI agents

The whole pipeline is open source. The commands that rebuild the files are in [Rebuild it yourself](/foundations#rebuild) on the list page. The full guide is [corpus/docs/OPEN-FOUNDATION-LIST.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/corpus/docs/OPEN-FOUNDATION-LIST.md).

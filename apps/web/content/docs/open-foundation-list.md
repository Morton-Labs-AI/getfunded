---
title: Using the Open Foundation List
description: What the free foundation list is, how to open it in Excel or Google Sheets, how to read it honestly, and how to cite it.
group: nonprofits
order: 8
---

# Using the Open Foundation List

The Open Foundation List is a free list of every U.S. private foundation that files Form 990-PF electronically. For each foundation it shows what it gave, what it holds, and whether it says it accepts applications.

You get the files from [the list page](/foundations). You may reuse them when you credit the source.

## What it is

The list comes from the returns that private foundations file with the IRS. Those returns are public records. We read them, put the main facts in two spreadsheet files, and publish the files.

| File | One row is | Use it to |
|---|---|---|
| `foundations.csv.gz` | One foundation | Build a list of foundations to look at: name, place, latest numbers, what it says about applications. |
| `foundation_years.csv.gz` | One foundation in one fiscal year | See how giving and assets changed from year to year. |

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
4. Select the `ein` column and the `zip` column. Set their data type to **Text**.
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
4. **Contact details are for shared inboxes and office phones only.** An email or a phone number appears only when the filing lists a shared inbox, such as grants@, or an office phone. A named person's address is left out.

## Check that your download is complete

This step is optional. Each download card shows a **file fingerprint**. It is a short code that changes if even one character of the file changes. The card shows the first 12 characters. The **Copy full fingerprint** button copies all of it.

To make the fingerprint of your own copy (a sha256 hash), run one command on the file you downloaded, before you unpack it:

- **Mac:** open Terminal and type `shasum -a 256 foundations.csv.gz`
- **Windows:** open Command Prompt and type `certutil -hashfile foundations.csv.gz SHA256`

If the result is the same as the full fingerprint, your file is complete and unchanged.

## How to cite

The list is published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). You may use it, share it and change it. You must credit the source. The IRS records underneath are public domain and need no credit.

1. Go to **How to cite** on [the list page](/foundations#downloads).
2. Choose **Copy citation**. The line names the source, the release, the release date, the page address and the license.
3. Paste the line where you use the data. If you changed the data, say so.

## How often it is refreshed

The list is refreshed when a new release is published. The release date and the years covered are on [the list page](/foundations#downloads).

## Found a mistake?

We publish returns as they were filed, and filers make mistakes. If a row looks wrong, open a [data correction issue](https://github.com/Morton-Labs-AI/getfunded/issues/new?template=data_correction.yml). Give the foundation's name, its EIN, and what you checked. You need a free GitHub account.

## For developers and AI agents

The whole pipeline is open source. The commands that rebuild the files are in [Rebuild it yourself](/foundations#rebuild) on the list page. The full guide is [corpus/docs/OPEN-FOUNDATION-LIST.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/corpus/docs/OPEN-FOUNDATION-LIST.md).

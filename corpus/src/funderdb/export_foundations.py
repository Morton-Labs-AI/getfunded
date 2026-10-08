"""The Open Foundation List: a small public file set anyone can download.

`funderdb export public` publishes every public view, 47M rows in 55 files.
Most people who want "a list of U.S. private foundations" need a few small
files instead:

    foundations.csv.gz                one row per private foundation
    foundation_years.csv.gz           one row per foundation per fiscal year
    foundation_grants_<year>.csv.gz   one row per LINKED grant, one file per
                                      fiscal year

This module writes them, with a README, a LICENSE and a manifest, into
``DIR/<vintage>/`` using the same publication pattern as export.py: files go
into a temporary folder, ``manifest.json`` is written last, the folder is
renamed into place, then ``LATEST`` is updated.

The licence boundary is structural, not a promise. Every query reads ONLY the
republishable surface, the ``public.*`` views, and only the seven listed in
ALLOWED_VIEWS (plus two optional views when the database has them, see below).
Before a byte is written the module checks that:

* every output column declares a source view and that view is allowed;
* every relation a query reads is an allowed view or one of the query's own
  CTEs, and no other schema is named anywhere in the SQL;
* each allowed view really is a view in schema ``public`` and has the columns
  the queries use;
* the two contact columns come from ``public.contact_channels`` and from
  nothing else, and the views that carry as-filed contact details
  (``public.filing_application_info``) are not read at all;
* a grant row names its recipient only through the organization record it is
  linked to; the recipient text the filer typed is never read;
* no query reads the purpose text of a grant row (see "Left out on purpose").

One failed check aborts with a nonzero exit and no files.

Pre-flight checks. The boundary checks read the SQL and the catalog. Two more
checks read the data, in the same snapshot the files are written from, and
also stop the run before a file is written:

* P1, amended returns. The loader inserts the grant rows of every filing and
  a later sweep removes the rows of a filing that an amended return replaced.
  Between the two, the same grants are in the database twice. The check stops
  the run when a grant row belongs to a replaced filing, when one return has
  grant rows from two filings, or when one return (same EIN, form and tax
  period) has two filings and neither is marked as replaced. The same
  statement lists the replaced filings that hold grant rows, and every grants
  read leaves out the rows of the filings on that list. A real export goes on
  only when the list is empty; the filter does work only in a sample made
  with ``--sample-ignore-preflight``, so that even such a sample does not
  count a grant twice.
* P2, application answers. ``public.org_application_posture`` is a stored
  result that is rebuilt by ``funderdb refresh-views``. The check stops the
  run when it is behind ``public.org_financial_series`` (a foundation's
  newest parsed Form 990-PF is not the return the answer row comes from).

``--sample-ignore-preflight`` lets a ``--limit`` sample go on after a failed
pre-flight check, to test the rest of the path while a loader is running. It
is refused without ``--limit``: a full export never skips them.

Left out on purpose.

* The purpose text of a grant is not in the grants files. It is free text and
  it can name a private person (a memorial gift, a scholarship). It can be
  read on the funder's profile page. A later release can add it after a
  privacy review.
* ``application_deadline_text`` is written as empty when the filed text holds
  an email address or a phone number. Contacts reach the files only through
  ``public.contact_channels``.
* A name that ends with an "in care of" part (`` C/O <name>``, `` % <name>``,
  `` IN CARE OF <name>``) is published cut before that part. The database
  keeps the registry name unchanged.

``manifest.json`` counts the blanked deadline texts and the cut names under
``withheld``.

Why the grants files hold linked grants only. A Form 990-PF grant row names
its recipient as free text, and some recipients are private persons
(scholarships, hardship grants). A bulk file must not name them. So a grant
row is written to a grants file only when ``recipient_org_id`` points at an
organization record, and the name, city and state in the file are that
record's, not the filer's text. Every other grant row is counted in
``foundation_years.csv.gz`` (``grants_not_linked_on_file``,
``amount_not_linked_on_file``) and never named.

Optional columns. Some columns exist only when the database exposes their
source on a public view. This is checked at run time and recorded in the
manifest under ``optional_columns``:

* ``irs_standing``, ``irs_revocation_date``, ``irs_on_pub78`` and
  ``irs_filed_after_revocation`` in ``foundations.csv.gz`` need the view
  ``public.org_irs_standing`` (migrations 0028 and 0032);
* ``address_basis`` in ``foundations.csv.gz`` needs an ``address_basis``
  column on ``public.organizations`` (migration 0030). It says whether city,
  state and zip come from the IRS master file or from the foundation's own
  latest return;
* ``link_basis`` in the grants files needs the view
  ``public.recipient_alias_links`` (migration 0034). The column has two
  values. ``filer_consensus``: the id of the grant row is in that view
  (three or more grant-making charities wrote this recipient name with this
  organization's EIN). ``name_match``: a Form 990-PF grant row that is not
  in the view. A Form 990-PF row gives no recipient EIN, so the only other
  job that links it is the name-and-place matcher. A grant row from a Form
  990 (Schedule I) has an empty cell: it can be linked by the EIN on the
  return or by the matcher, and no public view says which. When the view is
  not in the database the column is left out rather than guessed.

Honesty rules the files obey (the README repeats them for readers):

* ``not_stated`` is not closed. It means the latest parsed return says
  nothing about applications, or no return is on file.
* Empty means not available. A missing number is empty, never 0. A 0 in a
  money column is a filed zero. Counts are empty when nothing is on file.
* ``latest_*`` values come from the latest PARSED, unsuperseded return.

Determinism: every query runs in ONE read-only REPEATABLE READ transaction,
so all files describe the same moment of the database. Server-side COPY with
a total ORDER BY, timezone and DateStyle pinned, gzip with mtime 0 and an
empty filename. The same database gives the same bytes.

The long transaction has a cost. Its first read of the application answers
takes a share lock on the stored view behind them and keeps it until the last
file is written. ``funderdb refresh-views`` needs that view to itself, so a
refresh that starts while an export is open waits, and the web app's queries
wait behind the refresh. Do not start a refresh while an export (or a
``--timed-dry-run``) is open. The session names itself in
``application_name`` so that it can be seen in ``pg_stat_activity``, and the
run prints the time each statement took. ``--timed-dry-run`` sends every
statement, counts the rows and writes no file: use it to time a full export.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg

from . import ledger, staging
from .db import connect
from .export import (
    _clean_stale_tmp,
    _write_csv_gz,
    count_csv_records,
    publish,
    vintage_label,
)

DATASET = "export_foundations"
PROFILE_URL = "https://getfunded.ai/funder/"
ATTRIBUTION = "Open Funder Database contributors (GetFunded), from IRS e-file data"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
LICENCE_NAME = "CC BY 4.0"
# Where a tagged data release lives. `--release-json` builds its links from it.
RELEASES_URL = "https://github.com/Morton-Labs-AI/getfunded/releases"

# The only relations this export may read.
ALLOWED_VIEWS = (
    "public.organizations",
    "public.org_identifiers",
    "public.org_application_posture",
    "public.org_financial_series",
    "public.filings",
    "public.funding_events",
    "public.contact_channels",
)
# Read only when the database has them (checked with to_regclass at run time).
IRS_STANDING_VIEW = "public.org_irs_standing"
ALIAS_LINKS_VIEW = "public.recipient_alias_links"
CONTACT_VIEW = "public.contact_channels"
CONTACT_COLUMNS = ("public_contact_email", "public_contact_phone")
EVENTS_VIEW = "public.funding_events"
ORGS_VIEW = "public.organizations"

# `link_basis` appears in the grants files only when the database has the
# view ALIAS_LINKS_VIEW (migration 0034). That view has one row for each grant
# row that `funderdb resolve aliases --apply` linked and that still carries
# that link. The column has two values:
#
#   filer_consensus  the id of the grant row is in the view: three or more
#                    grant-making charities wrote this recipient name and
#                    state with this organization's EIN;
#   name_match       a Form 990-PF grant row that is not in the view. A Form
#                    990-PF row gives no recipient EIN, so the only other job
#                    that links it is the name-and-place matcher
#                    (`funderdb resolve recipients`).
#
# The cell is empty for a grant row that does not come from a Form 990-PF: a
# Schedule I row of a Form 990 (a few organizations that the IRS lists as
# private foundations filed Form 990 for a year). The loader links such a row
# by the EIN the filer wrote, and the matcher can link it by name later. No
# public view says which of the two it was, so the cell is empty and nothing
# is guessed. Measured read only on 2026-10-08: of the foundations with an
# EIN from 01 to 06, 10 have such linked rows (46 rows).
#
# The form is read from the row's own locator on public.funding_events: the
# loaders write there the path of the row inside the return. Any other value
# in a written file stops the export.
LINK_BASIS_CONSENSUS = "filer_consensus"
LINK_BASIS_NAME_MATCH = "name_match"
LINK_BASIS_VALUES = (LINK_BASIS_CONSENSUS, LINK_BASIS_NAME_MATCH)
# The key of the empty cells in the manifest's link_basis counts.
LINK_BASIS_EMPTY_KEY = "not_available"
ALIAS_LINKS_EVENT_COLUMN = "event_id"
EVENT_LOCATOR_COLUMN = "source_record_locator"
FORM_990PF_LOCATOR_PREFIX = "xpath:/Return/ReturnData/IRS990PF/"

# `address_basis` appears in foundations.csv.gz only when public.organizations
# has this column (migration 0030). The view's value 'filing_header' is
# written as `latest_return`; an address that came with a master-file row is
# written as `irs_master_file`; a row with no address has an empty cell. Any
# other value in the file stops the export.
ADDRESS_BASIS_SOURCE_COLUMN = "address_basis"
ADDRESS_BASIS_FILING = "filing_header"
ADDRESS_BASIS_VALUES = ("irs_master_file", "latest_return")
MASTER_FILE_DATASET = "irs_eo_bmf"

# With --limit, each grants file holds at most this many rows, so a sample
# stays inside the 20 second limit of the read-only role even when one of the
# sampled foundations made a very large number of grants.
GRANTS_SAMPLE_ROW_CAP = 5_000

GRANTS_KIND = "foundation_grants"
GRANTS_FILE_PATTERN = "foundation_grants_<fiscal_year>.csv.gz"
_TAG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")

# Values a filer writes in the "how to apply" box when there is nothing to say.
_NO_INSTRUCTIONS = ("N/A", "NA", "N.A.", "NONE", "NOT APPLICABLE", "NULL", "X")

# The name the session shows in pg_stat_activity while the export is open.
APPLICATION_NAME = "funderdb export foundations"

# application_deadline_text is free text, and a few filers wrote an email
# address or a phone number in it. Contacts reach the files only through
# public.contact_channels, so a deadline text that holds one is written as
# empty. The patterns are plain strings, never f-strings (the braces belong
# to the patterns), and they use only character classes that mean the same
# in Postgres and in Python, so the SQL and the check on the written bytes
# cannot disagree. Measured on the live rows of 2026-10-08: 29 of 29,632
# deadline texts are blanked; "@ 5 PM", ZIP+4 codes and dates are not.
DEADLINE_CONTACT_PATTERNS = (
    r"@[A-Za-z0-9]",                                  # an email address
    r"\(?[0-9]{3}\)?[-. ]?[0-9]{3}[-. ][0-9]{4}",     # a 10-digit phone number
    r"(^|[^0-9])[0-9]{3}[-. ][0-9]{4}([^0-9]|$)",     # a 7-digit phone number
)
_DEADLINE_HAS_CONTACT = "(" + " or ".join(
    f"p.submission_deadlines_txt ~ '{pattern}'" for pattern in DEADLINE_CONTACT_PATTERNS) + ")"
_DEADLINE_CONTACT_RE = re.compile("|".join(f"(?:{p})" for p in DEADLINE_CONTACT_PATTERNS))

# A registry name can end with an "in care of" part that names a person, a
# bank or a firm: "... FOUNDATION C/O <name>", "... TRUST % <name>". The
# files publish the name cut before that part; the database keeps the
# registry name. The marker must come after a space, so "C/O" or "%" inside
# a word is never cut, and something must come before it, so a cut name is
# never empty. Tested on the live names of 2026-10-08: 1,000 of the 165,314
# private foundation names in scope and about 890 public charity names are
# cut, and every cut name read by hand was a whole organization name. A
# marker with no space before it (two live names) is left as it is.
NAME_CARE_OF_PATTERN = r"([^ ]) +(C/O *|% *|IN CARE OF +)[^ ].*$"
_NAME_CARE_OF_RE = re.compile(r"[^ ] +(?:C/O *|% *|IN CARE OF +)[^ ]", re.I)


def _public_name(alias: str) -> str:
    """SQL for the published name of the organization row ``alias``."""
    return f"regexp_replace({alias}.name, '{NAME_CARE_OF_PATTERN}', '\\1', 'i')"


def _name_is_cut(alias: str) -> str:
    """SQL that is true when _public_name() changes the name of ``alias``."""
    return f"{alias}.name ~* '{NAME_CARE_OF_PATTERN}'"

Column = tuple[str, tuple[str, ...], str]

# ---------------------------------------------------------------------------
# Column dictionaries: (column, source view(s), meaning). The source views are
# checked against the allowed views before the export runs; the meanings
# become the README's column dictionary, so the documentation cannot drift
# from the file.
# ---------------------------------------------------------------------------
FOUNDATION_COLUMNS: list[Column] = [
    ("getfunded_id", ("public.organizations",),
     "Stable id of the foundation in this database (a UUID)."),
    ("ein", ("public.org_identifiers",),
     "IRS Employer Identification Number, 9 digits, with leading zeros."),
    ("name", ("public.organizations",),
     "Name as the IRS master file or the return gives it. An \"in care of\" part at the "
     "end (` C/O ...` or ` % ...`) is left out."),
    ("city", ("public.organizations",), "City of the mailing address."),
    ("state", ("public.organizations",), "State of the mailing address (2 letters)."),
    ("zip", ("public.organizations",), "ZIP code of the mailing address."),
    ("ntee_code", ("public.organizations",),
     "NTEE activity code from the IRS master file. Empty for many foundations."),
    ("ruling_year", ("public.organizations",),
     "Year the IRS recognized the exemption."),
    ("website", ("public.filings",),
     "Website the foundation wrote on its own latest return that states one."),
    ("first_fiscal_year", ("public.org_financial_series",),
     "Earliest fiscal year with a parsed return on file."),
    ("latest_fiscal_year", ("public.org_financial_series",),
     "Latest fiscal year with a parsed return on file."),
    ("years_on_file", ("public.org_financial_series",),
     "Number of fiscal years with a parsed return on file."),
    ("latest_total_assets", ("public.org_financial_series",),
     "Total assets at the end of the latest fiscal year, book value, in dollars."),
    ("latest_grants_paid", ("public.org_financial_series",),
     "Money paid out for charitable purposes in the latest fiscal year, in dollars. "
     "See latest_grants_paid_basis for which line it is."),
    ("latest_grants_paid_basis", ("public.org_financial_series",),
     "`qualifying_distributions` (Form 990-PF qualifying distributions) when the return "
     "has that line, else `charitable_disbursements` (Part I, column d, total). Empty "
     "when the return has neither."),
    ("latest_revenue", ("public.org_financial_series",),
     "Total revenue in the latest fiscal year, in dollars."),
    ("latest_expenses", ("public.org_financial_series",),
     "Total expenses in the latest fiscal year, in dollars."),
    ("grants_on_file", ("public.funding_events",),
     "Number of grant rows this database holds for the foundation, all years. "
     "Empty when it holds none."),
    ("grants_total_on_file", ("public.funding_events",),
     "Sum of those grant rows, in dollars."),
    ("application_posture", ("public.org_application_posture",),
     "`accepts_applications`, `preselected_only` or `not_stated`, from Part XV of the "
     "latest parsed Form 990-PF."),
    ("has_application_instructions", ("public.org_application_posture",),
     "`t` when that return describes how to apply, `f` when Part XV is there but "
     "says nothing useful, empty when there is no Part XV on file."),
    ("application_deadline_text", ("public.org_application_posture",),
     "Submission deadlines as filed. Empty when the filed text holds an email address "
     "or a phone number."),
    ("public_contact_email", ("public.contact_channels",),
     "A role inbox (such as grants@) that the foundation wrote in the application part "
     "of its return. Addresses of named people are never published. A contact is not "
     "an invitation: check application_posture first."),
    ("public_contact_phone", ("public.contact_channels",),
     "The phone number that the foundation wrote in the application part of its "
     "return, as +1XXXXXXXXXX. A contact is not an invitation: check "
     "application_posture first."),
    ("latest_filing_object_id", ("public.org_financial_series",),
     "IRS OBJECT_ID of the return the latest_* columns come from."),
    ("latest_filing_tax_period", ("public.org_financial_series",),
     "Tax period of that return, YYYYMM (the month the fiscal year ended)."),
    ("source_dataset", ("public.organizations", "public.filings", "public.funding_events",
                        "public.org_application_posture", "public.contact_channels"),
     "The source datasets this row draws on, separated by `;`."),
    ("profile_url", ("public.organizations",), "The foundation's page on getfunded.ai."),
]

# Optional: appended to foundations.csv.gz only when IRS_STANDING_VIEW exists
# (migration 0028). (output column, column of the view it is read from, meaning)
IRS_STANDING_SOURCE: list[tuple[str, str, str]] = [
    ("irs_standing", "standing",
     "What three IRS lists say about the foundation's tax-exempt status: `listed`, "
     "`not_listed`, `revoked`, `revoked_then_relisted` or `lists_disagree`. Empty when "
     "the lists are not loaded for it. The dates of the lists are in manifest.json."),
    ("irs_revocation_date", "effective_revocation_date",
     "Date of the foundation's latest automatic revocation, when the IRS list has one. "
     "A foundation that was reinstated later still has a date here, so read "
     "irs_standing with it. A listed date from 2020-04-01 to 2020-07-14 reads "
     "2020-07-15, as the IRS says it should."),
    ("irs_on_pub78", "on_pub78",
     "`t` when the foundation is in IRS Publication 78 data (organizations that can "
     "receive tax-deductible contributions), `f` when it is not. `f` alone does not "
     "mean that the foundation lost its status."),
    # Needs migration 0032 (the view column filed_after_revocation).
    ("irs_filed_after_revocation", "filed_after_revocation",
     "`t` when the foundation filed a return for a tax year after the date in "
     "irs_revocation_date, `f` when we hold no such return. Empty when the IRS list has "
     "no revocation for it. A foundation that loses its tax-exempt status must still "
     "file, so `t` does not mean that the IRS reinstated it."),
]
# The values of irs_standing, in plain words (the README prints them).
IRS_STANDING_VALUES: list[tuple[str, str]] = [
    ("listed", "In the IRS master file or in Publication 78, and not on the revocation list."),
    ("not_listed", "Not in the IRS master file and not in Publication 78. No revocation "
                   "is in force: it was never on the revocation list, or it was reinstated."),
    ("revoked", "On the Automatic Revocation of Exemption List with no reinstatement, and "
                "not in Publication 78. It is also not in the IRS master file, or the copy "
                "of the master file used here is older than the day the IRS posted the "
                "revocation, so the newer list is followed. This does not mean that the "
                "foundation has shut down: see irs_filed_after_revocation."),
    ("revoked_then_relisted", "Was on the revocation list and is in the IRS master file or "
                              "Publication 78 again. A reinstatement or a later ruling "
                              "date explains it."),
    ("lists_disagree", "On the revocation list with no reinstatement, and also in "
                       "Publication 78, or in a copy of the IRS master file that is not "
                       "older than the day the IRS posted the revocation. The lists do "
                       "not agree. Check with the IRS."),
]
IRS_STANDING_COLUMNS: list[Column] = [
    (c, (IRS_STANDING_VIEW,), meaning) for c, _src, meaning in IRS_STANDING_SOURCE]

YEAR_COLUMNS: list[Column] = [
    ("ein", ("public.org_identifiers",), "IRS Employer Identification Number."),
    ("getfunded_id", ("public.organizations",), "Same id as in foundations.csv.gz."),
    ("fiscal_year", ("public.org_financial_series",),
     "The year in which the fiscal year ended."),
    ("tax_period_end", ("public.org_financial_series",),
     "Last day of the fiscal year, YYYY-MM-DD."),
    ("return_type", ("public.org_financial_series",),
     "`990PF` or `990`. A few organizations that the IRS lists as private foundations "
     "filed Form 990 for a year; grants_paid is empty for those years."),
    ("total_revenue", ("public.org_financial_series",), "Total revenue, in dollars."),
    ("total_expenses", ("public.org_financial_series",), "Total expenses, in dollars."),
    ("total_assets_eoy", ("public.org_financial_series",),
     "Total assets at year end, book value, in dollars."),
    ("net_assets_eoy", ("public.org_financial_series",),
     "Net assets or fund balances at year end, in dollars."),
    ("grants_paid", ("public.org_financial_series",),
     "Qualifying distributions when the return has that line, else charitable "
     "disbursements, in dollars."),
    ("grants_paid_basis", ("public.org_financial_series",),
     "Which of the two lines grants_paid is: `qualifying_distributions` or "
     "`charitable_disbursements`."),
    ("n_grants_on_file", ("public.funding_events",),
     "Grant rows this database holds for that foundation and fiscal year. "
     "Empty when it holds none."),
    ("grants_linked_on_file", ("public.funding_events", "public.organizations"),
     "How many of those grant rows are in the grants file of that fiscal year: the "
     "rows whose recipient is linked to an organization record. Empty when the "
     "database holds no grant rows for the year."),
    ("grants_not_linked_on_file", ("public.funding_events", "public.organizations"),
     "How many of those grant rows are NOT in the grants file. Their recipient is not "
     "linked to an organization record, so they are counted here and never named."),
    ("amount_not_linked_on_file", ("public.funding_events", "public.organizations"),
     "Sum of the grant rows that are not in the grants file, in dollars. Empty when "
     "there are none."),
    ("filing_object_id", ("public.org_financial_series",),
     "IRS OBJECT_ID of the return."),
]

GRANT_COLUMNS: list[Column] = [
    ("funder_ein", ("public.org_identifiers",),
     "EIN of the foundation that made the grant. Same as ein in foundations.csv.gz."),
    ("funder_getfunded_id", ("public.organizations",),
     "Id of that foundation. Same as getfunded_id in foundations.csv.gz."),
    ("funder_name", ("public.organizations",),
     "Name of that foundation. Same as name in foundations.csv.gz."),
    # No purpose column: see "Left out on purpose" in the module docstring.
    # Check F8 stops the run if a query reads the purpose text.
    ("recipient_ein", ("public.org_identifiers",),
     "EIN of the organization record the recipient is linked to. Empty when that "
     "record has no EIN."),
    ("recipient_getfunded_id", ("public.organizations",),
     "Id of that organization record in this database (a UUID)."),
    ("recipient_name", ("public.organizations",),
     "Name on that organization record. It is NOT the text the foundation typed. An "
     "\"in care of\" part at the end (` C/O ...` or ` % ...`) is left out."),
    ("recipient_city", ("public.organizations",),
     "City on that organization record."),
    ("recipient_state", ("public.organizations",),
     "State on that organization record. Two letters on an IRS record. A record from "
     "another public source can have the full name of the state."),
    ("amount", ("public.funding_events",), "Amount of the grant as filed, in dollars."),
    ("fiscal_year", ("public.funding_events",),
     "The year in which the foundation's fiscal year ended."),
    ("filing_object_id", ("public.funding_events",),
     "IRS OBJECT_ID of the return the grant row comes from."),
]

# Optional: appended to the grants files only when the database has the view
# ALIAS_LINKS_VIEW (migration 0034). The values are in LINK_BASIS_MEANINGS.
LINK_BASIS_COLUMN: Column = (
    "link_basis", (ALIAS_LINKS_VIEW, EVENTS_VIEW),
    "How the recipient was linked to the organization record: `filer_consensus` "
    "(three or more grant-making charities wrote this recipient name and state on "
    "their own returns with this organization's EIN) or `name_match` (the "
    "name-and-place matcher of this project linked it: the name on the return matches "
    "exactly one organization). Empty for a grant row from a Form 990: the files do "
    "not say how that row was linked.")
# The values of link_basis, in plain words (the README prints them).
LINK_BASIS_MEANINGS: list[tuple[str, str]] = [
    (LINK_BASIS_CONSENSUS,
     "Three or more grant-making charities wrote this recipient name and state on "
     "their own returns (Form 990, Schedule I) with this organization's EIN, and all "
     "of them wrote the same EIN. The city on the foundation's grant row matched too."),
    (LINK_BASIS_NAME_MATCH,
     "The name-and-place matcher of this project linked the row. The name that the "
     "foundation wrote matches exactly one organization: the only one with that name "
     "in the same state, or the only one with that name in the country. In some "
     "builds an ending such as INC or LLC is not compared."),
]


# Optional: appended to foundations.csv.gz (after the IRS standing columns)
# only when public.organizations has the ADDRESS_BASIS_SOURCE_COLUMN column.
ADDRESS_BASIS_COLUMN: Column = (
    "address_basis", ("public.organizations",),
    "Where city, state and zip come from: `irs_master_file` (the IRS master file) or "
    "`latest_return` (the address the foundation wrote on its latest parsed return; used "
    "when the foundation is not in the master file). Empty when there is no address.")


def foundation_columns(irs_standing: bool = False, address_basis: bool = False) -> list[Column]:
    return (FOUNDATION_COLUMNS + (IRS_STANDING_COLUMNS if irs_standing else [])
            + ([ADDRESS_BASIS_COLUMN] if address_basis else []))


def grant_columns(link_basis: bool = False) -> list[Column]:
    return GRANT_COLUMNS + ([LINK_BASIS_COLUMN] if link_basis else [])


def grants_file_name(fiscal_year: int) -> str:
    return f"foundation_grants_{int(fiscal_year)}.csv.gz"


def _pf_cte(limit: int | None, inline: bool = False) -> str:
    """The foundations in scope: every private foundation with an EIN, lowest
    EIN first. ``limit`` keeps the first N (a sample for checking).

    ``inline`` is for a statement of the full list that reads ``pf`` twice.
    Postgres then computes the step once and keeps the result, and on the
    live database it joined the grant rows to that result with a sort of all
    grant rows. ``not materialized`` lets it plan each use on its own, which
    gives the same hash join as the statements that read ``pf`` once. A
    sample keeps the default: its ``limit`` makes the step small."""
    return f"""pf as {'not materialized ' if inline and not limit else ''}(
  select o.id as org_id, min(i.id_value) as ein
  from public.organizations o
  join public.org_identifiers i on i.org_id = o.id and i.id_type = 'ein'
  where o.org_type = 'private_foundation'
  group by o.id
  order by 2, 1{f'''
  limit {int(limit)}''' if limit else ''}
)"""


# One row per foundation per fiscal year. Two returns can end in the same
# calendar year (a short year after a change of year end); the later period
# is kept, then the greater object id.
_FIN_CTE = """fin as (
  select distinct on (s.org_id, s.fy)
         s.org_id, s.fy, s.tax_period, s.tax_period_end, s.return_type, s.object_id,
         s.total_revenue, s.total_expenses, s.total_assets_eoy, s.net_assets_eoy,
         s.qualifying_distributions, s.charitable_disbursements
  from public.org_financial_series s
  join pf on pf.org_id = s.org_id
  where s.fy is not null
  order by s.org_id, s.fy, s.tax_period desc, s.object_id desc
)"""

# The filings whose grant rows must not be counted: a filing that an amended
# return replaced. The rule is applied itself, not only the pointer the sweep
# sets: a filing is replaced when it is marked so, or when another filing of
# the same EIN, form and tax period has a greater object id (the sweep's own
# rule, sources/irs_filings.reconcile).
#
# The list of those filings is worked out ONCE, by the pre-flight statement
# (amended_returns_check_sql), in the snapshot every file is read from. Each
# grants read then leaves out the filings on the list (_not_lost). It is not
# a sub-query inside each read: on the full list that changed the plan of
# every statement (a sort of all grant rows), and the answer is the same in
# one snapshot. A real export only goes on when the list is empty, so its
# statements carry no filter at all. The list holds something only in a
# sample made with --sample-ignore-preflight, or in a --timed-dry-run.
_OBJECT_ID = re.compile(r"^[0-9A-Za-z_]+$")


def _not_lost(lost: tuple[str, ...] = ()) -> str:
    """SQL (an ``and ...`` line, or '') that leaves out the grant rows whose
    filing is on the list of replaced filings. A grant row with no filing id
    is kept."""
    if not lost:
        return ""
    bad = [x for x in lost if not _OBJECT_ID.match(x)]
    if bad:
        raise RuntimeError(f"not a filing object id: {bad[0]!r}")
    ids = ", ".join(f"'{x}'" for x in sorted(set(lost)))
    return f"\n    and (e.filing_object_id is null or e.filing_object_id not in ({ids}))"

_GRANTS_PAID = "coalesce({a}.qualifying_distributions, {a}.charitable_disbursements)"
_GRANTS_BASIS = ("case when {a}.qualifying_distributions is not null "
                 "then 'qualifying_distributions' "
                 "when {a}.charitable_disbursements is not null "
                 "then 'charitable_disbursements' end")


def foundations_sql(limit: int | None = None, irs_standing: bool = False,
                    address_basis: bool = False, lost: tuple[str, ...] = ()) -> str:
    junk = ", ".join(f"'{j}'" for j in _NO_INSTRUCTIONS)
    # `latest_return` only where the view says the address is a return's.
    # `irs_master_file` only for an address on a master-file row: an address
    # from any other source gets an empty cell, never a guessed label.
    basis_select = f""",
  case when o.{ADDRESS_BASIS_SOURCE_COLUMN} = '{ADDRESS_BASIS_FILING}' then 'latest_return'
       when coalesce(o.city, o.state, o.zip) is not null
            and o.source_dataset = '{MASTER_FILE_DATASET}' then 'irs_master_file'
  end as address_basis"""
    # The view has one row per organization EIN; pf holds one EIN per
    # foundation, so the join on both keeps one row per foundation.
    irs_cte = f""",
irs as (
  select st.org_id, {', '.join(f'st.{src}' for _c, src, _m in IRS_STANDING_SOURCE)}
  from {IRS_STANDING_VIEW} st
  join pf on pf.org_id = st.org_id and pf.ein = st.ein
)"""
    irs_select = "".join(f",\n  irs.{src} as {col}" for col, src, _m in IRS_STANDING_SOURCE)
    irs_join = "\nleft join irs on irs.org_id = pf.org_id"
    return f"""with {_pf_cte(limit)},
{_FIN_CTE},
span as (
  select org_id, min(fy) as first_fy, max(fy) as last_fy, count(*) as years_on_file
  from fin
  group by org_id
),
latest as (
  select distinct on (org_id) *
  from fin
  order by org_id, fy desc
),
latest_filing as (
  select l.org_id, f.source_dataset
  from latest l
  join public.filings f on f.object_id = l.object_id
),
grants as (
  select e.funder_org_id as org_id, count(*) as n, sum(e.amount) as total,
         array_agg(distinct e.source_dataset) as datasets
  from public.funding_events e
  join pf on pf.org_id = e.funder_org_id
  where e.event_type = 'grant'{_not_lost(lost)}
  group by e.funder_org_id
),
site as (
  select distinct on (f.org_id) f.org_id, f.website
  from public.filings f
  join pf on pf.org_id = f.org_id
  where f.website is not null and f.superseded_by_object_id is null
  order by f.org_id, f.tax_period desc, f.object_id desc
),
contact as (
  select c.org_id,
         min(c.value) filter (where c.channel_type = 'email') as email,
         min(c.value) filter (where c.channel_type = 'phone') as phone,
         array_agg(distinct c.source_dataset) as datasets
  from public.contact_channels c
  join pf on pf.org_id = c.org_id
  where c.channel_type in ('email', 'phone')
  group by c.org_id
){irs_cte if irs_standing else ''}
select
  o.id as getfunded_id,
  pf.ein,
  {_public_name('o')} as name,
  o.city, o.state, o.zip, o.ntee_code,
  date_part('year', o.ruling_date)::int as ruling_year,
  site.website,
  span.first_fy as first_fiscal_year,
  span.last_fy as latest_fiscal_year,
  span.years_on_file,
  latest.total_assets_eoy as latest_total_assets,
  {_GRANTS_PAID.format(a='latest')} as latest_grants_paid,
  {_GRANTS_BASIS.format(a='latest')} as latest_grants_paid_basis,
  latest.total_revenue as latest_revenue,
  latest.total_expenses as latest_expenses,
  grants.n as grants_on_file,
  grants.total as grants_total_on_file,
  case p.application_posture
    when 'open' then 'accepts_applications'
    when 'preselected_only' then 'preselected_only'
    else 'not_stated' end as application_posture,
  case when p.org_id is null or not p.has_part_xv then null
       else coalesce(btrim(p.form_and_info_txt), '') <> ''
            and upper(btrim(p.form_and_info_txt)) not in ({junk}) end
    as has_application_instructions,
  case when {_DEADLINE_HAS_CONTACT} then null
       else p.submission_deadlines_txt end as application_deadline_text,
  contact.email as public_contact_email,
  contact.phone as public_contact_phone,
  latest.object_id as latest_filing_object_id,
  latest.tax_period as latest_filing_tax_period,
  (select string_agg(d, ';' order by d)
   from (select distinct unnest(
           array[o.source_dataset, latest_filing.source_dataset, p.source_dataset]
           || coalesce(grants.datasets, '{{}}') || coalesce(contact.datasets, '{{}}')) as d) x
   where d is not null) as source_dataset,
  '{PROFILE_URL}' || o.id::text as profile_url{irs_select if irs_standing else ''}{basis_select if address_basis else ''}
from pf
join public.organizations o on o.id = pf.org_id
left join span on span.org_id = pf.org_id
left join latest on latest.org_id = pf.org_id
left join latest_filing on latest_filing.org_id = pf.org_id
left join grants on grants.org_id = pf.org_id
left join site on site.org_id = pf.org_id
left join contact on contact.org_id = pf.org_id
left join public.org_application_posture p on p.org_id = pf.org_id{irs_join if irs_standing else ''}
order by pf.ein, o.id"""


# "Linked" has one meaning in every query below: the grant row's
# recipient_org_id points at an organization that public.organizations shows.
# The years query and the coverage query count it with a LEFT join; the grants
# query keeps it with an INNER join. So for one snapshot of the database,
# grants_linked_on_file adds up to the rows of the grants files.
def years_sql(limit: int | None = None, lost: tuple[str, ...] = ()) -> str:
    return f"""with {_pf_cte(limit)},
{_FIN_CTE},
grants as (
  select e.funder_org_id as org_id, e.fiscal_year,
         count(*) as n,
         count(r.id) as n_linked,
         count(*) - count(r.id) as n_not_linked,
         sum(e.amount) filter (where r.id is null) as amount_not_linked
  from public.funding_events e
  join pf on pf.org_id = e.funder_org_id
  left join public.organizations r on r.id = e.recipient_org_id
  where e.event_type = 'grant' and e.fiscal_year is not null{_not_lost(lost)}
  group by e.funder_org_id, e.fiscal_year
)
select
  pf.ein,
  o.id as getfunded_id,
  fin.fy as fiscal_year,
  fin.tax_period_end,
  fin.return_type,
  fin.total_revenue,
  fin.total_expenses,
  fin.total_assets_eoy,
  fin.net_assets_eoy,
  {_GRANTS_PAID.format(a='fin')} as grants_paid,
  {_GRANTS_BASIS.format(a='fin')} as grants_paid_basis,
  grants.n as n_grants_on_file,
  grants.n_linked as grants_linked_on_file,
  grants.n_not_linked as grants_not_linked_on_file,
  grants.amount_not_linked as amount_not_linked_on_file,
  fin.object_id as filing_object_id
from pf
join public.organizations o on o.id = pf.org_id
join fin on fin.org_id = pf.org_id
left join grants on grants.org_id = pf.org_id and grants.fiscal_year = fin.fy
order by pf.ein, o.id, fin.fy"""


def irs_lists_as_of_sql() -> str:
    """The dates of the two IRS lists behind the irs_* columns. Every row of
    the view carries the same two dates, so one row is enough."""
    return f"""select st.revocation_list_as_of, st.pub78_as_of, st.master_file_as_of
from {IRS_STANDING_VIEW} st
limit 1"""


def grant_coverage_sql(limit: int | None = None, lost: tuple[str, ...] = ()) -> str:
    """The grant rows of the foundations in scope, counted in small groups:
    fiscal year, linked or not, the source dataset of the linked organization
    record, and whether the recipient's name is cut. One read of the grant
    rows gives every count; fold_coverage() adds the groups up for each
    fiscal year. It names the fiscal years that get a grants file and gives
    the row count each file must have. It joins the same relations as the
    statement it replaced (no join to the funder's record), so the full list
    keeps one sequential read of the grant rows."""
    return f"""with {_pf_cte(limit)}
select e.fiscal_year,
       (r.id is not null) as linked,
       r.source_dataset as recipient_dataset,
       coalesce({_name_is_cut('r')}, false) as recipient_name_cut,
       count(*) as n,
       sum(e.amount) as amount
from public.funding_events e
join pf on pf.org_id = e.funder_org_id
left join public.organizations r on r.id = e.recipient_org_id
where e.event_type = 'grant'{_not_lost(lost)}
group by 1, 2, 3, 4
order by 1, 2, 3, 4"""


def fold_coverage(rows) -> tuple[list[dict], dict[str, int]]:
    """Add up the groups of grant_coverage_sql(). Returns one dict for each
    fiscal year (a row with no fiscal year last) and, for the linked rows, the
    number of rows per source dataset of the organization record."""
    years: dict = {}
    datasets: dict[str, int] = {}
    for fy, linked, dataset, recipient_cut, n, amount in rows:
        y = years.setdefault(fy, {
            "fiscal_year": int(fy) if fy is not None else None,
            "grants": 0, "linked": 0, "not_linked": 0,
            "amount_linked": None, "amount_not_linked": None,
            "linked_recipient_name_cut": 0})
        y["grants"] += n
        kind = "linked" if linked else "not_linked"
        y[kind] += n
        if amount is not None:   # a missing sum stays missing; it is not 0
            y[f"amount_{kind}"] = (y[f"amount_{kind}"] or 0) + amount
        if linked:
            y["linked_recipient_name_cut"] += n if recipient_cut else 0
            key = dataset or "not_stated"
            datasets[key] = datasets.get(key, 0) + n
    ordered = sorted(years.values(),
                     key=lambda y: (y["fiscal_year"] is None, y["fiscal_year"] or 0))
    return ordered, dict(sorted(datasets.items()))


def amended_returns_check_sql(limit: int | None = None) -> str:
    """Pre-flight check P1. One row: four numbers that must all be 0, and the
    list of replaced filings that hold grant rows.

    1. grant rows whose filing is marked as replaced by an amended return;
    2. returns (EIN, form, tax period) whose grant rows come from two filings;
    3. returns that have two filings and neither is marked as replaced (the
       sweep that settles amended returns has not run for them);
    4. grant rows whose filing the rule replaces: it is marked as replaced,
       or a filing of the same return has a greater object id. These are the
       rows the grants reads leave out;
    5. the object ids of those filings (the list for _not_lost).

    Numbers 1, 2 and 4 start from the grant rows of the foundations in scope
    and find each row's filing by its object id (step ``fl``). Number 3 and
    the "greater object id" test use the filings of the EINs in scope (step
    ``nw``, scoped by EIN and not by org_id, because a filing that was just
    loaded has no org_id yet). The EIN of a filing is a char(9) column:
    pf.ein is cast to that type so that the index on the column is used and
    a sample stays fast."""
    return f"""with {_pf_cte(limit, inline=True)},
ev as (
  select e.filing_object_id, count(*) as n
  from public.funding_events e
  join pf on pf.org_id = e.funder_org_id
  where e.event_type = 'grant' and e.filing_object_id is not null
  group by 1
),
fl as (
  select f.object_id, ev.n, f.ein, f.return_type, f.tax_period,
         f.superseded_by_object_id
  from ev
  join public.filings f on f.object_id = ev.filing_object_id
),
nw as (
  select f.ein, f.return_type, f.tax_period,
         max(f.object_id) as newest_object_id,
         count(*) filter (where f.superseded_by_object_id is null) as live
  from public.filings f
  join pf on f.ein = pf.ein::bpchar
  where coalesce(f.tax_period, '') <> ''
  group by f.ein, f.return_type, f.tax_period
  having count(*) > 1
),
lost as (
  select fl.object_id, fl.n
  from fl
  left join nw on nw.ein = fl.ein and nw.return_type = fl.return_type
       and nw.tax_period = fl.tax_period
  where fl.superseded_by_object_id is not null
     or nw.newest_object_id > fl.object_id
)
select
  (select coalesce(sum(fl.n), 0) from fl
   where fl.superseded_by_object_id is not null) as rows_of_marked_filings,
  (select count(*) from (
     select 1 from fl
     where coalesce(fl.tax_period, '') <> ''
     group by fl.ein, fl.return_type, fl.tax_period
     having count(*) > 1) d) as returns_with_rows_from_two_filings,
  (select count(*) from nw where nw.live > 1) as returns_with_two_live_filings,
  (select coalesce(sum(lost.n), 0) from lost) as rows_of_replaced_filings,
  (select array_agg(lost.object_id order by lost.object_id) from lost) as replaced_filings"""


def posture_view_check_sql(limit: int | None = None) -> str:
    """Pre-flight check P2: foundations whose newest parsed Form 990-PF (as
    public.org_financial_series shows it now) is not the return their row in
    public.org_application_posture comes from, or that have no row there.
    The order is the stored view's own rule. Must be 0."""
    return f"""with {_pf_cte(limit)},
l as (
  select distinct on (s.org_id) s.org_id, s.object_id
  from public.org_financial_series s
  join pf on pf.org_id = s.org_id
  where s.return_type = '990PF'
  order by s.org_id, s.tax_period desc, s.object_id desc
)
select count(*)
from l
left join public.org_application_posture p on p.org_id = l.org_id
where p.object_id is null or p.object_id <> l.object_id"""


def withheld_counts_sql(limit: int | None = None) -> str:
    """How many values foundations.csv.gz holds back: names that are cut
    before an "in care of" part, and deadline texts written as empty because
    they hold an email address or a phone number."""
    return f"""with {_pf_cte(limit)}
select count(*) filter (where {_name_is_cut('o')}) as names_cut,
       count(*) filter (where {_DEADLINE_HAS_CONTACT}) as deadline_texts_blanked
from pf
join public.organizations o on o.id = pf.org_id
left join public.org_application_posture p on p.org_id = pf.org_id"""


# Is the grant row `e` in the view of the filer-consensus links? True or NULL.
#
# It is a look-up for each row, on purpose, and it is written with
# `= any (array[e.id])` on purpose. Each look-up is one probe of the primary
# key of the link ledger (event_id), and a few more key probes for a row
# that is in it. The view is read only for the linked grant rows of the one
# fiscal year.
#
# Three other forms were measured on a throwaway database on 2026-10-08:
# 1.2 million grant rows, 120,500 linked rows in the fiscal year, a link
# ledger of 180,000 rows, one alias with 60,000 links. This look-up took 1.2
# to 1.6 seconds there. The statement without the column took 0.6 seconds.
#
# * A LEFT JOIN to the view. The view checks that the grant row still points
#   at the alias's organization. Because of that check the planner expects
#   the whole view to return 1 row, whatever it holds. With parallel workers
#   off it chose a nested loop that reads the whole stored view again for
#   every grant row: 46 seconds with 20,000 ledger rows (2.4 billion pairs
#   compared) and 12 minutes 18 seconds with 180,000 (21.7 billion pairs).
#   The live database gave the same plan shape with an empty ledger. The
#   time grows with rows times links.
# * A hash join (nested loops switched off): 1.0 second there. But it works
#   out the whole view in every fiscal-year statement. On the live database
#   that is one more read of the grants table, or one key probe for each
#   link of every year, for each grants file. Not measured on live.
# * The same look-up with `al.event_id = e.id`. The planner then knows the
#   id of the grant row inside the view too. It started at the grants
#   table, reached the ledger through the alias, and read every link of the
#   alias for every grant row of that alias: 21 seconds.
#
# `= any (array[...])` is not an equality that the planner passes on to the
# other tables of the view. So the only way into the view is the primary
# key of the ledger, whatever the statistics say. `limit 1` states that one
# row is enough; the key allows no more.
_LINK_LOOKUP = (f"(select true from {ALIAS_LINKS_VIEW} al\n"
                f"                    where al.{ALIAS_LINKS_EVENT_COLUMN} = any (array[e.id]) "
                "limit 1)")


def grants_sql(fiscal_year: int, limit: int | None = None, row_cap: int | None = None,
               link_basis: bool = False, lost: tuple[str, ...] = ()) -> str:
    """One fiscal year of linked grants. The recipient's name, city, state and
    EIN come from the linked organization record (alias ``r`` and the ``rid``
    step); the as-filed recipient text of public.funding_events is not read,
    and neither is the purpose text. The order is total: the last key is the
    grant row's own id.

    ``link_basis`` adds the column of that name (see LINK_BASIS_VALUES). For
    each linked grant row of the fiscal year, the statement looks the row's
    id up in the view of the filer-consensus links (_LINK_LOOKUP). That is
    one probe of the primary key of the link ledger, and for a hit a few
    more key probes inside the view."""
    basis_step = f""",
         case when {_LINK_LOOKUP}
              then '{LINK_BASIS_CONSENSUS}'
              when e.{EVENT_LOCATOR_COLUMN} like '{FORM_990PF_LOCATOR_PREFIX}%'
              then '{LINK_BASIS_NAME_MATCH}'
         end as link_basis""" if link_basis else ""
    basis_out = ",\n  g.link_basis" if link_basis else ""
    cap = f"\nlimit {int(row_cap)}" if row_cap else ""
    return f"""with {_pf_cte(limit)},
g as (
  select pf.ein as funder_ein, e.funder_org_id, e.id as event_id, e.recipient_org_id,
         e.amount, e.fiscal_year, e.filing_object_id{basis_step}
  from public.funding_events e
  join pf on pf.org_id = e.funder_org_id
  where e.event_type = 'grant'
    and e.fiscal_year = {int(fiscal_year)}
    and e.recipient_org_id is not null{_not_lost(lost)}
),
rid as (
  select i.org_id, min(i.id_value) as ein
  from public.org_identifiers i
  where i.id_type = 'ein'
    and i.org_id in (select g.recipient_org_id from g)
  group by i.org_id
)
select
  g.funder_ein,
  fo.id as funder_getfunded_id,
  {_public_name('fo')} as funder_name,
  rid.ein as recipient_ein,
  r.id as recipient_getfunded_id,
  {_public_name('r')} as recipient_name,
  r.city as recipient_city,
  r.state as recipient_state,
  g.amount,
  g.fiscal_year,
  g.filing_object_id{basis_out}
from g
join public.organizations fo on fo.id = g.funder_org_id
join public.organizations r on r.id = g.recipient_org_id
left join rid on rid.org_id = r.id
order by g.funder_ein, g.filing_object_id, rid.ein, g.amount, g.event_id{cap}"""


# ---------------------------------------------------------------------------
# Boundary checks
# ---------------------------------------------------------------------------
_CTE_NAME = re.compile(r"(?:\bwith|,)\s*(\w+)\s+as\s+(?:not\s+materialized\s+)?\(", re.I)
_RELATION = re.compile(r"\b(?:from|join)\s+([a-z_][\w.]*)", re.I)
_SCHEMAS = ("internal", "information_schema", "pg_catalog", "extensions", "auth", "vault")
# The recipient text a filer typed. No query of this export may read it.
_AS_FILED_RECIPIENT = re.compile(
    r"\b\w+\.recipient_(?:name|city|state|address|zip|country|foundation_status|relationship)\b",
    re.I)
# Where each recipient column of a grants file must come from.
_RECIPIENT_SOURCES = (
    ("recipient_getfunded_id", "r.id"),
    ("recipient_name", _public_name("r")),
    ("recipient_city", "r.city"),
    ("recipient_state", "r.state"),
    ("recipient_ein", "rid.ein"),
)


def relations_read(sql: str) -> set[str]:
    """Every relation a query reads that is not one of its own CTEs."""
    ctes = {m.group(1).lower() for m in _CTE_NAME.finditer(sql)}
    out = set()
    for m in _RELATION.finditer(sql):
        rel = m.group(1).lower()
        if rel not in ctes and rel != "unnest":
            out.add(rel)
    return out


def cte_body(sql: str, name: str) -> str:
    """Text of one CTE's parenthesised body ('' when the query has no such CTE)."""
    m = re.search(rf"\b{name}\s+as\s*\(", sql, re.I)
    if not m:
        return ""
    depth, i = 1, m.end()
    while i < len(sql) and depth:
        depth += {"(": 1, ")": -1}.get(sql[i], 0)
        i += 1
    return sql[m.end():i - 1]


def static_checks(queries: dict[str, str], columns: dict[str, list[Column]],
                  allowed: tuple[str, ...] = ALLOWED_VIEWS) -> list[dict]:
    """Boundary checks that need no database: they read the column dictionaries
    and the SQL text itself. ``queries`` holds every statement the run will
    send (the grants statement once, as a template: the per-year statements
    differ from it only in the year number). ``columns`` maps each kind of
    file to its column dictionary."""
    out: list[dict] = []
    all_columns = [c for cols in columns.values() for c in cols]

    def add(aid: str, statement: str, problems: list[str]) -> None:
        out.append({"id": aid, "statement": statement,
                    "result": "PASS" if not problems else "FAIL", "problems": problems})

    declared = [(c, v) for c, views, _ in all_columns for v in views]
    add("F1", "every output column declares a source view and it is an allowed public view",
        sorted({f"{c} <- {v}" for c, v in declared if v not in allowed}))

    bad_rel = []
    for qname, sql in queries.items():
        bad_rel += [f"{qname}: {r}" for r in sorted(relations_read(sql))
                    if r not in allowed]
    add("F2", "every relation the queries read is an allowed public view or their own CTE",
        bad_rel)

    bad_schema = []
    for qname, sql in queries.items():
        for schema in _SCHEMAS:
            if re.search(rf"\b{schema}\s*\.", sql, re.I):
                bad_schema.append(f"{qname}: names schema {schema}")
        if "filing_application_info" in sql.lower():
            bad_schema.append(f"{qname}: reads filing_application_info")
    add("F3", "no other schema and no as-filed contact view is named in the SQL", bad_schema)

    contact_problems = []
    for c, views, _ in all_columns:
        if c in CONTACT_COLUMNS and views != (CONTACT_VIEW,):
            contact_problems.append(f"{c} declares {views}")
    for kind, cols in columns.items():
        if kind != "foundations":
            contact_problems += [f"{kind} has a contact column {c}" for c, _v, _m in cols
                                 if c in CONTACT_COLUMNS or re.search(r"email|phone", c)]
    fsql = queries["foundations"]
    body_rels = relations_read("with x as (select 1) " + cte_body(fsql, "contact")) - {"pf"}
    if body_rels != {CONTACT_VIEW}:
        contact_problems.append(f"contact CTE reads {sorted(body_rels)}")
    for col, src in (("public_contact_email", "contact.email"),
                     ("public_contact_phone", "contact.phone")):
        if not re.search(rf"\b{re.escape(src)}\s+as\s+{col}\b", fsql):
            contact_problems.append(f"{col} is not selected from {src}")
    # No other alias may yield an email or phone value (public.filings has a
    # filer phone column; it must never reach these files).
    for m in re.finditer(r"\b(\w+)\.(email|phone)\b", fsql, re.I):
        if m.group(1).lower() != "contact":
            contact_problems.append(f"{m.group(0)} is read outside the contact CTE")
    for qname, sql in queries.items():
        if qname == "foundations":
            continue
        if CONTACT_VIEW in sql.lower():
            contact_problems.append(f"{qname} reads {CONTACT_VIEW}")
        if re.search(r"\b(email|phone)\b", sql, re.I):
            contact_problems.append(f"{qname} names an email or phone column")
    add("F4", f"contact columns come only from {CONTACT_VIEW}", contact_problems)

    # F7: the grants files name organizations, never the filer's free text.
    recipient_problems = []
    for qname, sql in queries.items():
        recipient_problems += [f"{qname}: reads {m.group(0)}"
                               for m in _AS_FILED_RECIPIENT.finditer(sql)]
    gsql = queries[GRANTS_KIND]
    if not re.search(r"\brecipient_org_id\s+is\s+not\s+null\b", cte_body(gsql, "g"), re.I):
        recipient_problems.append("the g step does not keep only linked grant rows")
    join = re.search(r"(\w+)\s+join\s+public\.organizations\s+r\s+on\s+"
                     r"r\.id\s*=\s*g\.recipient_org_id\b", gsql, re.I)
    if not join or join.group(1).lower() in ("left", "right", "full", "outer", "cross"):
        recipient_problems.append(
            "the grants query does not INNER join public.organizations r on the linked id")
    for col, src in _RECIPIENT_SOURCES:
        if not re.search(rf"\b{re.escape(src)}\s+as\s+{col}\b", gsql):
            recipient_problems.append(f"{col} is not selected from {src}")
    rid_rels = relations_read("with x as (select 1) " + cte_body(gsql, "rid")) - {"g"}
    if rid_rels != {"public.org_identifiers"}:
        recipient_problems.append(f"rid step reads {sorted(rid_rels)}")
    for c, views, _ in columns.get(GRANTS_KIND, []):
        if c.startswith("recipient_") and not set(views) <= {ORGS_VIEW, "public.org_identifiers"}:
            recipient_problems.append(f"{c} declares {views}")
    add("F7", "a grant row names its recipient only through the linked organization "
              f"record ({ORGS_VIEW}); the as-filed recipient text is never read",
        recipient_problems)

    # F8: the purpose of a grant is free text and can name a private person.
    # It is not published, so no statement may read it and no file may have
    # a column for it.
    purpose_problems = [f"{qname}: reads the purpose text" for qname, sql in queries.items()
                        if re.search(r"purpose", sql, re.I)]
    purpose_problems += [f"{kind} has a purpose column {c}" for kind, cols in columns.items()
                         for c, _v, _m in cols if "purpose" in c.lower()]
    add("F8", "no query reads the purpose text of a grant row, and no file has a "
              "column for it", purpose_problems)
    out.sort(key=lambda c: c["id"])
    return out


def view_columns_used(irs_standing: bool = False, link_basis: bool = False,
                      address_basis: bool = False) -> dict:
    """The columns the queries read on each view (checked against the catalog)."""
    used = {
        "public.organizations": ("id", "name", "city", "state", "zip", "ntee_code",
                                 "ruling_date", "org_type", "source_dataset"),
        "public.org_identifiers": ("org_id", "id_type", "id_value"),
        "public.org_application_posture": ("org_id", "object_id", "application_posture",
                                           "has_part_xv", "form_and_info_txt",
                                           "submission_deadlines_txt", "source_dataset"),
        "public.org_financial_series": ("org_id", "fy", "tax_period", "tax_period_end",
                                        "return_type", "object_id", "total_revenue",
                                        "total_expenses", "total_assets_eoy", "net_assets_eoy",
                                        "qualifying_distributions",
                                        "charitable_disbursements"),
        "public.filings": ("object_id", "org_id", "ein", "return_type", "tax_period",
                           "website", "superseded_by_object_id", "source_dataset"),
        "public.funding_events": ("id", "funder_org_id", "recipient_org_id", "event_type",
                                  "amount", "fiscal_year", "filing_object_id",
                                  "source_dataset"),
        "public.contact_channels": ("org_id", "channel_type", "value", "source_dataset"),
    }
    if irs_standing:
        used[IRS_STANDING_VIEW] = ("org_id", "ein",
                                   *(src for _c, src, _m in IRS_STANDING_SOURCE),
                                   "revocation_list_as_of", "pub78_as_of",
                                   "master_file_as_of")
    if link_basis:
        used[EVENTS_VIEW] = (*used[EVENTS_VIEW], EVENT_LOCATOR_COLUMN)
        used[ALIAS_LINKS_VIEW] = (ALIAS_LINKS_EVENT_COLUMN,)
    if address_basis:
        used[ORGS_VIEW] = (*used[ORGS_VIEW], ADDRESS_BASIS_SOURCE_COLUMN)
    return used


def database_checks(cur, allowed: tuple[str, ...] = ALLOWED_VIEWS,
                    used: dict | None = None) -> list[dict]:
    """Each allowed relation is a view in schema public and has the columns
    the queries use. Reads the catalog only."""
    used = used if used is not None else view_columns_used()
    cur.execute("select table_name from information_schema.views where table_schema = 'public'")
    views = {r[0] for r in cur.fetchall()}
    missing = [v for v in allowed if v.split(".", 1)[1] not in views]
    cur.execute("select table_name, column_name from information_schema.columns "
                "where table_schema = 'public'")
    have: dict[str, set[str]] = {}
    for t, c in cur.fetchall():
        have.setdefault(t, set()).add(c)
    absent = [f"{v}.{c}" for v, cols in used.items() for c in cols
              if c not in have.get(v.split(".", 1)[1], set())]
    return [
        {"id": "F5", "statement": "every relation read is a view in schema public",
         "result": "PASS" if not missing else "FAIL", "problems": missing},
        {"id": "F6", "statement": "every column the queries use exists on its public view",
         "result": "PASS" if not absent else "FAIL", "problems": absent},
    ]


def detect_optional(cur) -> list[dict]:
    """Which optional columns this database can supply. Reads the catalog only.
    One entry per optional group, kept in the manifest as ``optional_columns``."""
    cur.execute(
        "select to_regclass(%s::text) is not null, "
        "coalesce(has_table_privilege(to_regclass(%s::text)::oid, 'select'), false)",
        (IRS_STANDING_VIEW, IRS_STANDING_VIEW))
    exists, readable = cur.fetchone()
    irs = {
        "id": "irs_standing",
        "file": "foundations.csv.gz",
        "columns": [c for c, _s, _m in IRS_STANDING_SOURCE],
        "source": IRS_STANDING_VIEW,
        "present": bool(exists and readable),
        "reason": ("the view is in this database" if exists and readable else
                   "the view is in this database, but this connection may not read it"
                   if exists else
                   f"the view {IRS_STANDING_VIEW} is not in this database, "
                   "so the columns are left out"),
    }
    cur.execute(
        "select to_regclass(%s::text) is not null, "
        "coalesce(has_table_privilege(to_regclass(%s::text)::oid, 'select'), false)",
        (ALIAS_LINKS_VIEW, ALIAS_LINKS_VIEW))
    links_exist, links_readable = cur.fetchone()
    has_basis = bool(links_exist and links_readable)
    basis = {
        "id": "link_basis",
        "file": GRANTS_FILE_PATTERN,
        "columns": [LINK_BASIS_COLUMN[0]],
        "source": ALIAS_LINKS_VIEW,
        "present": has_basis,
        "values": list(LINK_BASIS_VALUES),
        "reason": ("the view is in this database" if has_basis else
                   "the view is in this database, but this connection may not read it"
                   if links_exist else
                   f"the view {ALIAS_LINKS_VIEW} is not in this database (migration 0034 "
                   "is not applied), so the files do not say how a recipient was linked. "
                   "The column is left out, not guessed"),
    }
    cur.execute(
        "select exists (select 1 from information_schema.columns "
        "where table_schema = 'public' and table_name = 'organizations' "
        "and column_name = %s)", (ADDRESS_BASIS_SOURCE_COLUMN,))
    has_address_basis = bool(cur.fetchone()[0])
    address = {
        "id": "address_basis",
        "file": "foundations.csv.gz",
        "columns": [ADDRESS_BASIS_COLUMN[0]],
        "source": f"{ORGS_VIEW}.{ADDRESS_BASIS_SOURCE_COLUMN}",
        "present": has_address_basis,
        "reason": ("the column is in this database" if has_address_basis else
                   f"{ORGS_VIEW} has no {ADDRESS_BASIS_SOURCE_COLUMN} column (migration 0030 "
                   "is not applied), so the column is left out"),
    }
    return [irs, basis, address]


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def git_commit(start: Path | None = None) -> str | None:
    """HEAD's commit hash, read from the .git files. It does not run git and
    does not look at the working tree, so uncommitted edits are not reflected."""
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        dotgit = parent / ".git"
        if dotgit.is_file():   # a worktree: "gitdir: <path>"
            target = dotgit.read_text(encoding="utf-8").partition("gitdir:")[2].strip()
            dotgit = (parent / target).resolve() if target else dotgit
        if not dotgit.is_dir():
            continue
        try:
            head = (dotgit / "HEAD").read_text(encoding="utf-8").strip()
            if not head.startswith("ref:"):
                return head or None
            ref = head.partition("ref:")[2].strip()
            common = dotgit
            if (dotgit / "commondir").exists():
                common = (dotgit / (dotgit / "commondir").read_text().strip()).resolve()
            for base in (dotgit, common):
                if (base / ref).exists():
                    return (base / ref).read_text(encoding="utf-8").strip() or None
            packed = common / "packed-refs"
            if packed.exists():
                for line in packed.read_text(encoding="utf-8").splitlines():
                    if line.endswith(" " + ref):
                        return line.split(" ", 1)[0]
        except OSError:
            return None
        return None
    return None


def _iter_rows(path: Path):
    """Rows of a written .csv.gz as dicts, streamed (the years file is large)."""
    with gzip.open(path, "rb") as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8", newline=""))


def _money(value) -> float | None:
    """A dollar sum for the manifest. None stays None: a missing sum is not 0."""
    return None if value is None else float(value)


def _license_text() -> str:
    return f"""Open Foundation List

THE FILES
foundations.csv.gz, foundation_years.csv.gz and the grants files named
{GRANTS_FILE_PATTERN} (one for each fiscal year).

THE COMPILATION
This project's own work in these files is the selection of the records, their
arrangement, and the columns that are derived from them. That work, and only
that work, is licensed under the Creative Commons Attribution 4.0
International licence (CC BY 4.0):

    {LICENSE_URL}

You may copy, share and adapt the files for any purpose, including commercial
use, when you give credit. Use this credit line:

    {ATTRIBUTION}

THE UNDERLYING RECORDS
Almost all facts come from records of the U.S. Internal Revenue Service:
Form 990-PF and Form 990 e-file data, the Exempt Organizations Business
Master File and, when the files have the irs_* columns, the Automatic
Revocation of Exemption List and Publication 78 data. In the grants files,
the organization record of a recipient can come from another public source:
an SEC Form D filing, the SBIR award data, or the list of federal agencies
that this project keeps. manifest.json names the source datasets and counts
the rows of each.

The IRS, SEC and SBIR records are public records released by the U.S.
Government. The list of federal agencies is a short list of public facts
that this project wrote. Names, websites and deadline texts in the returns
are the words of the organizations that filed them. Facts are not subject
to copyright, and this licence does not restrict them. This licence asks
for no credit for the facts alone.

NAMES IN THE GRANTS FILES
The grants files are built to name organizations only. A grant row is in a
grants file only when its recipient is linked to an organization record, and
the name in the file is the name on that record. The purpose that the
foundation wrote for a grant is not in the files. Grant rows that are not
linked are counted in foundation_years.csv.gz and are not named. A link can
be wrong. If a row names a private person, report it so that it can be
corrected.

NO WARRANTY
The files are provided as they are. They can contain errors made by the
filers, by the IRS, or by this project. Check the original return before you
rely on a figure.
"""


def _dictionary(columns: list[Column]) -> str:
    lines = ["| Column | Meaning |", "|---|---|"]
    lines += [f"| `{c}` | {meaning} |" for c, _views, meaning in columns]
    return "\n".join(lines)


def _file_summary(f: dict) -> str:
    """One plain sentence for a file. Used by the README and the release JSON."""
    if f["kind"] == "foundations":
        return ("One row for each U.S. private foundation: name, place, latest numbers, "
                "and what its latest return says about applications.")
    if f["kind"] == "foundation_years":
        return ("One row for each foundation and fiscal year: revenue, expenses, assets, "
                "giving, and how many of its grant rows are in the grants files.")
    return (f"Grants that foundations reported for fiscal year {f['fiscal_year']}, one row "
            "for each grant whose recipient is linked to an organization record. Other "
            "grants are counted in foundation_years.csv.gz and are not named.")


def _coverage_table(coverage: dict) -> str:
    """Link coverage for each fiscal year: the linked rows (they are the rows
    of the grants file) and the rows that are not linked (counted, not named).
    The numbers are the database's, so a sample's row cap does not change them."""
    lines = ["| Fiscal year | Grant rows on file | Linked rows (in the grants file) "
             "| Not linked rows (counted, not named) | Share linked |",
             "|---|---|---|---|---|"]
    for y in coverage["by_fiscal_year"]:
        fy = y["fiscal_year"] if y["fiscal_year"] is not None else "not stated"
        share = ""
        if y["grants_on_file"]:
            pct = 100 * y["linked"] / y["grants_on_file"]
            # "0%" would read as "none" when a few rows are linked.
            share = "0%" if not y["linked"] else "less than 1%" if pct < 1 else f"{pct:.0f}%"
        lines.append(f"| {fy} | {y['grants_on_file']:,} | {y['linked']:,} "
                     f"| {y['not_linked']:,} | {share} |")
    return "\n".join(lines)


def _readme(m: dict) -> str:
    files = m["files"]
    grant_files = [f for f in files if f["kind"] == GRANTS_KIND]
    optional = {o["id"]: o for o in m["optional_columns"]}
    sample = ""
    if m["limit"]:
        sample = (f"\n> This is a SAMPLE of the first {m['limit']:,} foundations by EIN, "
                  "made with `--limit`. It is not the full list.")
        if m["grants_row_cap"]:
            sample += (f" Each grants file holds at most {m['grants_row_cap']:,} rows "
                       "in a sample.")
        if m.get("preflight_ignored"):
            sample += (" The pre-flight checks did NOT pass for this sample and were "
                       "skipped with `--sample-ignore-preflight`. Its numbers can be "
                       "wrong. Do not publish it.")
        sample += "\n"
    years = m["fiscal_years"]
    withheld = m["withheld"]
    recipient_sources = m["grants_coverage"].get("recipient_source_datasets") or {}
    recipient_sources_line = ", ".join(
        f"`{d}` ({n:,} rows)" for d, n in recipient_sources.items()) or "none"
    file_rows = "\n".join(
        f"| `{f['name']}` | "
        + ("One row for each private foundation." if f["kind"] == "foundations" else
           "One row for each foundation and fiscal year." if f["kind"] == "foundation_years"
           else f"One row for each linked grant of fiscal year {f['fiscal_year']}.")
        + f" | {f['rows']:,} |" for f in files)
    absent = [o for o in m["optional_columns"] if not o["present"]]
    absent_note = ""
    if absent:
        absent_note = ("\n## Columns that are not in this build\n\n"
                       + "\n".join(f"- {', '.join(f'`{c}`' for c in o['columns'])} "
                                   f"(in `{o['file']}`): {o['reason']}." for o in absent)
                       + "\n")
    irs_note = ""
    if optional["irs_standing"]["present"]:
        as_of = optional["irs_standing"].get("lists_as_of") or {}
        values = "\n".join(f"- `{v}`: {meaning}" for v, meaning in IRS_STANDING_VALUES)
        irs_note = f"""
## The IRS standing columns

`irs_standing`, `irs_revocation_date` and `irs_on_pub78` say what three IRS
lists show: the Exempt Organizations Business Master File, Publication 78
data and the Automatic Revocation of Exemption List. They are not a legal
opinion. Check with the IRS before you rely on them.
`irs_filed_after_revocation` comes from the returns, not from an IRS list.

- Automatic Revocation of Exemption List used here: {as_of.get('automatic_revocation_list') or 'date not available'}.
- Publication 78 data used here: {as_of.get('publication_78') or 'date not available'}.
- Copy of the IRS master file used here: {as_of.get('irs_master_file') or 'date not available'}.

Each list is a copy with a date. When the copy of the master file is older
than the day the IRS posted a revocation, the master file still names the
foundation only because the copy is older. Such a foundation is `revoked`,
not `lists_disagree`.

The values of `irs_standing`:

{values}

The revocation list holds only automatic revocations (no return for three
years in a row). It does not hold other kinds of revocation. An empty
`irs_standing` means that the lists are not available for the foundation.
"""
    grants_dictionary = _dictionary(grant_columns(optional["link_basis"]["present"]))
    link_note = link_bullet = ""
    if optional["link_basis"]["present"]:
        counts = optional["link_basis"].get("link_basis_counts") or {}
        values = "\n".join(f"- `{v}`: {meaning}" for v, meaning in LINK_BASIS_MEANINGS)
        link_bullet = ("\n- `link_basis` says how each row was linked. See \"How a recipient "
                       "was linked\".")
        link_note = f"""
## How a recipient was linked

A foundation's return gives the name of each grant recipient and no EIN. The
column `link_basis` says how this database linked the name to an organization
record. It has two values:

{values}

The cell is empty for a grant row that comes from a Form 990 and not from a
Form 990-PF. A few organizations that the IRS lists as private foundations
filed Form 990 for a year. Such a row can be linked by the EIN that the
filer wrote, and the files do not say how it was linked.

Each kind of link can be wrong. Use `filing_object_id` to check a row
against the return.

Rows in the grants files of this build: `{LINK_BASIS_CONSENSUS}` {counts.get(LINK_BASIS_CONSENSUS, 0):,}, `{LINK_BASIS_NAME_MATCH}` {counts.get(LINK_BASIS_NAME_MATCH, 0):,}, empty {counts.get(LINK_BASIS_EMPTY_KEY, 0):,}.
`manifest.json` has the same counts for each grants file.
"""
    has_address_basis = optional.get("address_basis", {}).get("present", False)
    foundations_dictionary = _dictionary(
        foundation_columns(optional["irs_standing"]["present"], has_address_basis))
    address_limit = ""
    if has_address_basis:
        address_limit = (
            "\n- A foundation that is not in the IRS master file has the address it wrote on "
            "its\n  latest parsed return. `address_basis` says which source a row has. An "
            "address\n  from a return is as old as that return.")
    return f"""# Open Foundation List — {m['vintage']}
{sample}
A list of U.S. private foundations, built from public records. Almost all of
them are records of the IRS. Anyone can download it, use it and share it.

## The files

| File | What it is | Rows |
|---|---|---|
{file_rows}
| `manifest.json` | Row counts, sha256 of each file, sources, how it was built. | |
| `LICENSE.txt` | The licence and the credit line. | |

The CSV files are gzip files. Excel, Google Sheets, R, pandas and DuckDB can
open them. The text is UTF-8. The first line has the column names.
`foundations.csv.gz` and `foundation_years.csv.gz` are sorted by `ein`. The
grants files are sorted by `funder_ein`, then `filing_object_id`, then
`recipient_ein`, then `amount`.

Fiscal years in `foundation_years.csv.gz`: {years['first'] or 'none'} to {years['last'] or 'none'}.
Grants files in this build: {len(grant_files)}.

## How to read the files honestly

1. **`not_stated` is not closed.** `application_posture` is `not_stated` when
   the latest return says nothing about applications, or when no return is on
   file. It does not mean the foundation refuses applications.
2. **Empty means not available.** An empty cell means this database does not
   have the value. It does not mean zero. A `0` in a money column is a zero
   that the foundation filed.
3. **`grants_on_file` counts what this database holds.** It is not the number
   of grants the foundation made. It is empty when the database holds no grant
   rows for the foundation.
4. **`latest_grants_paid` is one of two lines.** The column
   `latest_grants_paid_basis` says which one. Qualifying distributions include
   some costs of giving, not only grants.
5. **The latest values come from the latest parsed return.** A newer return
   can exist at the IRS that is not in the bulk data yet.
6. **Amended returns replace the original.** Only the newest filing of a
   return is used, and its grants are counted once. The export checks this
   before it writes a file.
7. **Contacts are limited on purpose.** `public_contact_email` is only a role
   inbox, such as `grants@`, that the foundation wrote in the application
   part of its return. The address of a named person is never published.
8. **A contact is not an invitation. Check `application_posture` first.** A
   foundation that says `preselected_only` can still have a contact in this
   file. It does not ask for requests.
9. **The return is the source.** Filers make mistakes. Use
   `latest_filing_object_id` or `filing_object_id` to find the original
   return at the IRS.
10. **The grants files do not hold every grant.** They hold only the grant
    rows whose recipient is linked to an organization record. Read the next
    section before you add up a grants file.

## What the grants files hold, and what they leave out

A foundation's return gives the name of each grant recipient as free text.
Some recipients are private persons, for example a student with a
scholarship. A public bulk file must not name them. For this reason:

- A grant row is in a grants file only when this database has linked its
  recipient to an organization record.
- `recipient_name`, `recipient_city`, `recipient_state` and `recipient_ein`
  come from that organization record. They are not the text that the
  foundation typed.
- Every other grant row is counted and is not named. The counts are in
  `foundation_years.csv.gz`: `grants_linked_on_file`,
  `grants_not_linked_on_file` and `amount_not_linked_on_file`.
- "Not linked" does not mean that the recipient is a person. The recipient
  can be an organization that this database could not link.
- The sum of a grants file is less than what the foundations gave. Do not
  use it as a total of giving. Use `grants_paid` in
  `foundation_years.csv.gz` for that.
- A link can be wrong. If a row names a private person, report it.{link_bullet}
- The purpose of a grant is not in the files. See "What is left out on
  purpose".

Link coverage for each fiscal year. A linked row is in the grants file. A row
that is not linked is counted and is not named:

{_coverage_table(m['grants_coverage'])}

"Linked" means linked when this build was made. A low share in a fiscal year
means that fewer of its rows were matched to an organization record. It does
not mean that the other recipients are persons.

The organization records that recipients are linked to come from these source
datasets: {recipient_sources_line}.

## What is left out on purpose

- **The purpose of a grant.** A foundation writes the purpose of each grant
  as free text, and that text can name a private person (for example a gift
  in memory of someone). The purpose is not in this release. You can read it
  on the foundation's profile page (`profile_url` in `foundations.csv.gz`).
  A later release can add it after a privacy review.
- **Contact details inside a deadline text.** `application_deadline_text` is
  empty when the filed text holds an email address or a phone number.
  Deadline texts made empty in this build: {withheld['application_deadline_text']['blanked']:,}.
- **The "in care of" part of a name.** Some names on IRS records end with
  ` C/O ` or ` % ` and the name of a person, a bank or a firm. The files give
  the name cut before that part. Foundation names cut in
  `foundations.csv.gz` in this build: {withheld['names']['foundation_names_cut']:,}. The same rule is used for
  `funder_name` and `recipient_name` in the grants files (linked grant rows
  with a cut recipient name: {withheld['names']['linked_grant_rows_recipient_name_cut']:,}).

## Columns of `foundations.csv.gz`

{foundations_dictionary}
{irs_note}
## Columns of `foundation_years.csv.gz`

{_dictionary(YEAR_COLUMNS)}

If a foundation filed two returns that end in the same calendar year, the
file keeps the return with the later end date. The grant counts are for the
fiscal year, so they include the grant rows of both returns.

`grants_linked_on_file` plus `grants_not_linked_on_file` is `n_grants_on_file`.
A `0` in one of these two columns means that the database holds grant rows
for the year and none of them is of that kind.

## Columns of `{GRANTS_FILE_PATTERN}`

One file for each fiscal year. One row for each linked grant.

{grants_dictionary}
{link_note}{absent_note}
## How to cite

> {ATTRIBUTION}. Open Foundation List, version {m['vintage']}.

CC BY 4.0 covers the compilation: the selection, the arrangement and the
derived columns. The facts come from public records. Facts are not subject
to copyright, and the licence does not restrict them. See `LICENSE.txt`.

## Known limits

- Only returns filed electronically are in the IRS bulk data. Paper returns
  are not.
- The IRS publishes returns in batches. Some returns are listed by the IRS
  before their data is published.
- Years on file depend on which IRS index years this database has loaded:
  {', '.join(str(y) for y in m['index_years_covered']) or 'none'}.
- Name, address, NTEE code and ruling year come from the IRS master file. It
  can be up to two years behind.{address_limit}
- A grants file can hold a grant row of a fiscal year that has no row in
  `foundation_years.csv.gz`. This happens when the grant table of a return is
  loaded and its financial data is not.
- A foundation with no EIN in the database is not in the list.

## How it was built

Every value comes from a `public.*` view of the Open Funder Database. Those
views show only records that may be republished. The export checks this
before it writes a file. It also checks that no amended return is counted
twice and that the application answers are up to date. The checks and their
results are in `manifest.json`. All files are read from the database at one
moment.

To build it again from the same database:

```
uv run funderdb export foundations --out DIR
```

The same database gives the same files, byte for byte. Compare the sha256
values in `manifest.json` to check a copy.

To report an error, name the return (its `filing_object_id`) or the public
record that shows the right value.
"""


def release_document(manifest: dict, tag: str) -> dict:
    """The JSON the website reads (apps/web/content/data-release.json): the
    release tag, the vintage, and one entry for each CSV file with its
    download link, size, sha256 and row count."""
    if not _TAG.match(tag or ""):
        raise ValueError("--tag must be a plain release name such as data-2026-10-08 "
                         "(letters, digits, dot, dash, underscore)")
    doc = {
        "tag": tag,
        "vintage": manifest["vintage"],
        "published_at": manifest["generated_at"],
        "index_years": manifest["index_years_covered"],
        "licence": LICENCE_NAME,
        "attribution": ATTRIBUTION,
        "release_url": f"{RELEASES_URL}/tag/{tag}",
        "files": [{
            "name": f["name"],
            "url": f"{RELEASES_URL}/download/{tag}/{f['name']}",
            "bytes": f["bytes"],
            "sha256": f["sha256"],
            "rows": f["rows"],
            "description": _file_summary(f),
            # Not in the website's first contract: the columns this file
            # really has, so a page can leave out an optional column that
            # this build does not have.
            "columns": f["columns"],
        } for f in manifest["files"]],
    }
    if manifest["limit"]:
        # A sample is not a release. The key marks the file so nobody ships it.
        doc["sample_limit"] = manifest["limit"]
    return doc


def write_release_json(path: Path, manifest: dict, tag: str) -> dict:
    """Write the release JSON in one step (a temporary file, then a rename)."""
    doc = release_document(manifest, tag)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return doc


P1_FIX = (
    "Amended returns are not settled in the database yet, so grants can be counted "
    "twice.\n"
    "Wait until `funderdb backfill` has finished and has printed its \"supersession "
    "sweep\" line\nfor every year it loaded. Then run the export again.")
P2_FIX = (
    "The application answers are behind the financial data, so some foundations would "
    "show\n`not_stated` although their newest return states an answer.\n"
    "Run these two commands first, in this order, and then run the export again:\n"
    "    uv run funderdb refresh-views\n"
    "    uv run funderdb contacts sync-part-xv")


def preflight_checks(cur, queries: dict[str, str], timed=None) -> list[dict]:
    """The two checks that read the data (P1 and P2 in the module docstring).
    They run in the export's own snapshot, so they test exactly the rows the
    files are written from. ``timed(label, fn)`` returns ``fn()`` and records
    how long it took."""
    run_timed = timed or (lambda _label, fn: fn())

    def one_row(name: str):
        def go():
            cur.execute(queries[name])
            return cur.fetchone()
        return run_timed(name, go)

    marked_rows, two_filings, two_live, lost_rows, lost_ids = one_row("check_amended_returns")
    marked_rows, two_filings, two_live, lost_rows = (
        int(marked_rows), int(two_filings), int(two_live), int(lost_rows))
    lost = tuple(lost_ids or ())
    problems = []
    if marked_rows:
        problems.append("grant rows of a filing that is marked as replaced by an amended "
                        f"return: {marked_rows:,}")
    if two_filings:
        problems.append(f"returns with grant rows from two filings: {two_filings:,}")
    if two_live:
        problems.append("returns with two filings where neither is marked as replaced: "
                        f"{two_live:,}")
    if lost_rows:
        problems.append("grant rows that a newer filing of the same return replaces: "
                        f"{lost_rows:,} (number of such filings: {len(lost):,})")
    p1 = {
        "id": "P1",
        "statement": "no grant row is counted twice because of an amended return",
        "result": "PASS" if not problems else "FAIL",
        "numbers": {"grant_rows_of_filings_marked_replaced": marked_rows,
                    "returns_with_grant_rows_from_two_filings": two_filings,
                    "returns_with_two_filings_not_marked_replaced": two_live,
                    "grant_rows_of_replaced_filings": lost_rows,
                    "replaced_filings_with_grant_rows": len(lost)},
        # The filings whose grant rows every grants read leaves out. Empty in
        # every export that passed the check.
        "replaced_filings_left_out": list(lost),
        "problems": problems,
        "fix": P1_FIX,
    }
    behind = int(one_row("check_posture_view")[0])
    p2 = {
        "id": "P2",
        "statement": "the application answers are as new as the financial data",
        "result": "PASS" if not behind else "FAIL",
        "numbers": {"foundations_with_an_answer_row_that_is_behind_or_missing": behind},
        "problems": (["foundations whose newest parsed Form 990-PF is not the return their "
                      f"application answer comes from: {behind:,}"] if behind else []),
        "fix": P2_FIX,
    }
    for check in (p1, p2):
        if check["result"] == "PASS":
            del check["fix"]   # what to do is recorded only for a failed check
    return [p1, p2]


def _count_copy(cur, sql: str) -> tuple[int, int]:
    """Send a statement the way a file is written (COPY to the client, as
    CSV) and throw the bytes away. Returns (rows, bytes). The server does the
    same work as for a real file; only gzip and the disk are left out."""
    records, in_quotes, size = 0, False, 0
    with cur.copy(f"copy ({sql}) to stdout with (format csv, header true, null '')") as copy:
        for chunk in copy:
            b = bytes(chunk)
            n, in_quotes = count_csv_records(b, in_quotes)
            records += n
            size += len(b)
    return max(0, records - 1), size   # minus the header record


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------
def run(out_dir: Path | None, *, limit: int | None = None, no_ledger: bool = False,
        statement_timeout: str | None = None, tag: str | None = None,
        release_json: Path | None = None, timed_dry_run: bool = False,
        sample_ignore_preflight: bool = False, echo=print) -> dict:
    """Write ``out_dir/<vintage>/``. ``statement_timeout`` defaults to 20s for a
    ``limit`` sample (the cap of the app's read-only role, so a sample proves
    the queries are cheap) and to 60min for the full list. With
    ``release_json`` the JSON the website reads is written after everything
    else succeeded; it needs ``tag``, the name of the release.

    ``timed_dry_run`` sends every statement, counts the rows, prints the time
    each one took and writes nothing: no file, no folder, no ledger row. It
    goes on after a failed pre-flight check (it has nothing to publish) and
    reports the failure in its result.

    ``sample_ignore_preflight`` lets a ``limit`` sample go on after a failed
    pre-flight check. It is refused without ``limit``."""
    if limit is not None and limit <= 0:
        raise ValueError("--limit must be a positive number")
    if sample_ignore_preflight and not limit:
        raise ValueError("--sample-ignore-preflight works only with --limit. A full export "
                         "never skips the pre-flight checks.")
    if timed_dry_run and (release_json is not None or tag):
        raise ValueError("--timed-dry-run writes no files, so it cannot be used with "
                         "--tag or --release-json")
    if not timed_dry_run and out_dir is None:
        raise ValueError("--out is needed (the folder to publish into)")
    if release_json is not None and not tag:
        raise ValueError("--release-json needs --tag, the name of the release "
                         "(for example data-2026-10-08)")
    if tag is not None and not _TAG.match(tag):
        raise ValueError("--tag must be a plain release name such as data-2026-10-08 "
                         "(letters, digits, dot, dash, underscore)")
    timeout = statement_timeout or ("20s" if limit else "60min")
    row_cap = GRANTS_SAMPLE_ROW_CAP if limit else None

    generated = datetime.now(timezone.utc).replace(microsecond=0)
    vintage = vintage_label(generated)
    tmp = final = None
    if not timed_dry_run:
        tmp, final = out_dir / f".tmp-{vintage}", out_dir / vintage
        if final.exists():
            # The vintage is a time to the second. Stop before any work is done.
            raise RuntimeError(f"a build named {vintage} is already in {out_dir}; "
                               "wait one second and run again")
    files: list[dict] = []
    timings: list[dict] = []
    started = time.monotonic()

    def timed(label: str, fn):
        """Run one statement and record how long it took."""
        t0 = time.monotonic()
        result = fn()
        timings.append({"statement": label, "seconds": round(time.monotonic() - t0, 1)})
        return result

    def took() -> str:
        return f"{timings[-1]['seconds']:.1f}s"

    with connect() as conn:
        # One snapshot for every statement: the files must describe the same
        # moment, or grants_linked_on_file would not add up to the grants
        # files while a loader is writing. This export never writes through
        # this session.
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            # A name for this session, so that `funderdb refresh-views` and a
            # person who looks at pg_stat_activity can see who holds the
            # share lock on the application answers.
            cur.execute(f"set application_name = '{APPLICATION_NAME}'")
            cur.execute(f"set local statement_timeout = '{timeout}'")
            cur.execute("set local timezone = 'UTC'")
            cur.execute("set local datestyle = 'ISO, MDY'")

            optional = detect_optional(cur)
            option = {o["id"]: o for o in optional}
            use = {o["id"]: o["present"] for o in optional}
            allowed = (ALLOWED_VIEWS
                       + ((IRS_STANDING_VIEW,) if use["irs_standing"] else ())
                       + ((ALIAS_LINKS_VIEW,) if use["link_basis"] else ()))
            columns = {
                "foundations": foundation_columns(use["irs_standing"], use["address_basis"]),
                "foundation_years": YEAR_COLUMNS,
                GRANTS_KIND: grant_columns(use["link_basis"]),
            }

            def build_queries(lost: tuple[str, ...] = ()) -> dict[str, str]:
                """Every statement of the run. ``lost`` is the list of
                replaced filings whose grant rows the grants reads leave out."""
                q = {
                    "foundations": foundations_sql(limit, use["irs_standing"],
                                                   use["address_basis"], lost),
                    "foundation_years": years_sql(limit, lost),
                    "grant_coverage": grant_coverage_sql(limit, lost),
                    # The template of the per-year statements (year 0).
                    GRANTS_KIND: grants_sql(0, limit, row_cap, use["link_basis"], lost),
                    # The pre-flight checks and the count of withheld values
                    # read the same views, so the boundary checks cover them.
                    "check_amended_returns": amended_returns_check_sql(limit),
                    "check_posture_view": posture_view_check_sql(limit),
                    "withheld_counts": withheld_counts_sql(limit),
                }
                if use["irs_standing"]:
                    q["irs_lists_as_of"] = irs_lists_as_of_sql()
                return q

            queries = build_queries()
            checks = static_checks(queries, columns, allowed)
            checks += database_checks(
                cur, allowed, view_columns_used(use["irs_standing"], use["link_basis"],
                                                use["address_basis"]))
            checks.sort(key=lambda c: c["id"])
            for c in checks:
                echo(f"  {c['result']} {c['id']}  {c['statement']}"
                     + (f"  -> {'; '.join(c['problems'][:6])}" if c["problems"] else ""))
            if any(c["result"] == "FAIL" for c in checks):
                raise SystemExit("\nBOUNDARY VIOLATION — a check failed. No files written.")
            for o in optional:
                echo(f"  optional {', '.join(o['columns'])}: "
                     f"{'included' if o['present'] else 'left out'} ({o['reason']})")

            # The pre-flight checks read the data in this same snapshot. They
            # come before the first file, so a failed check leaves no files.
            preflight = preflight_checks(cur, queries, timed)
            for c, t in zip(preflight, timings[-len(preflight):]):
                echo(f"  {c['result']} {c['id']}  {c['statement']}  ({t['seconds']:.1f}s)"
                     + (f"  -> {'; '.join(c['problems'])}" if c["problems"] else ""))
            failed = [c for c in preflight if c["result"] == "FAIL"]
            preflight_ignored = False
            # The replaced filings that hold grant rows. Empty when P1 passed.
            lost = tuple(preflight[0]["replaced_filings_left_out"])
            if failed:
                fixes = "\n\n".join(f"{c['id']}: {c['fix']}" for c in failed)
                if timed_dry_run:
                    echo(f"\n{fixes}\n\n  --timed-dry-run: a real export stops here. The dry "
                         "run goes on, only to time the statements.")
                elif sample_ignore_preflight:
                    preflight_ignored = True
                    echo(f"\n{fixes}\n\n  --sample-ignore-preflight: the sample goes on. Its "
                         "numbers can be wrong. Do not publish it.")
                else:
                    raise SystemExit("\nPRE-FLIGHT CHECK FAILED. No files written.\n\n" + fixes)

            if lost:
                # Only after a failed P1 that was not a stop: a sample with
                # --sample-ignore-preflight, or a dry run. The grants reads
                # now leave out the rows of the replaced filings, and the
                # boundary checks read the statements again as they are sent.
                queries = build_queries(lost)
                if any(c["result"] == "FAIL" for c in static_checks(queries, columns, allowed)):
                    raise SystemExit("\nBOUNDARY VIOLATION — a check failed. No files written.")
                echo("  the grants reads leave out the grant rows of the replaced filings "
                     f"(number of filings: {len(lost):,})")
            if timed_dry_run:
                echo("  --timed-dry-run: every statement is sent and its rows are counted; "
                     "no file is written")
            else:
                out_dir.mkdir(parents=True, exist_ok=True)
                _clean_stale_tmp(out_dir, echo=echo)
                tmp.mkdir()
                echo(f"  writing {tmp} (published as {final.name} on success)")

            def write(kind: str, name: str, sql: str, cols: list[Column], order_by: str) -> dict:
                if timed_dry_run:
                    rows, size = timed(name, lambda: _count_copy(cur, sql))
                    meta = {"name": name, "rows": rows, "bytes_uncompressed": size}
                else:
                    meta = timed(name, lambda: _write_csv_gz(cur, sql, tmp / name))
                meta["kind"] = kind
                meta["columns"] = [c for c, _v, _m in cols]
                meta["views"] = sorted({v for _c, views, _m in cols for v in views})
                meta["order_by"] = order_by
                files.append(meta)
                echo(f"  {meta['rows']:>10,}  {meta['name']}  ({took()})")
                return meta

            def fetch(name: str, one: bool = False):
                def go():
                    cur.execute(queries[name])
                    return cur.fetchone() if one else cur.fetchall()
                result = timed(name, go)
                echo(f"  {'':>10}  statement {name}  ({took()})")
                return result

            write("foundations", "foundations.csv.gz", queries["foundations"],
                  columns["foundations"], "ein")
            names_cut, deadlines_blanked = (int(v) for v in fetch("withheld_counts", one=True))
            write("foundation_years", "foundation_years.csv.gz", queries["foundation_years"],
                  columns["foundation_years"], "ein, fiscal_year")
            if use["irs_standing"]:
                as_of = fetch("irs_lists_as_of", one=True)
                option["irs_standing"]["lists_as_of"] = {
                    "automatic_revocation_list": as_of[0].isoformat() if as_of and as_of[0]
                    else None,
                    "publication_78": as_of[1].isoformat() if as_of and as_of[1] else None,
                    "irs_master_file": as_of[2].isoformat() if as_of and as_of[2] else None,
                }
            # One statement and one file for each fiscal year that has a
            # linked grant. The coverage statement names those years and gives
            # the row count each file must have; the same snapshot makes it
            # exact. It runs after the two files above so that, on a cold
            # cache, no statement of a sample has to read more than they did.
            coverage_years, recipient_datasets = fold_coverage(fetch("grant_coverage"))
            for y in coverage_years:
                fy, linked = y["fiscal_year"], y["linked"]
                if fy is None or not linked:
                    continue
                meta = write(GRANTS_KIND, grants_file_name(fy),
                             grants_sql(fy, limit, row_cap, use["link_basis"], lost),
                             columns[GRANTS_KIND],
                             "funder_ein, filing_object_id, recipient_ein, amount "
                             "(then the grant row's id, so the order is total)")
                meta["fiscal_year"] = int(fy)
                meta["row_cap"] = row_cap
                meta["row_cap_reached"] = bool(row_cap and linked > row_cap)
                want = min(linked, row_cap) if row_cap else linked
                if meta["rows"] != want:
                    raise RuntimeError(
                        f"{meta['name']}: {meta['rows']:,} rows written, but the coverage "
                        f"count for fiscal year {fy} is {want:,}")
        conn.rollback()
    total_seconds = round(time.monotonic() - started, 1)
    echo(f"  all statements took {total_seconds:.1f}s in one transaction")

    if timed_dry_run:
        echo("  --timed-dry-run: nothing was written")
        return {
            "dry_run": True,
            "limit": limit,
            "statement_timeout": timeout,
            "preflight_checks": preflight,
            "preflight_passed": not failed,
            "statements": timings,
            "total_seconds": total_seconds,
            "files": files,
        }

    # Facts about what was written, read back from the files themselves so the
    # manifest describes the bytes, not the intention.
    by_kind = {f["kind"]: f for f in files if f["kind"] != GRANTS_KIND}
    dataset_set: set[str] = set()
    posture = {"accepts_applications": 0, "preselected_only": 0, "not_stated": 0}
    seen_ids: set[str] = set()
    standing_counts: dict[str, int] = {}
    address_counts: dict[str, int] = {}
    for i, r in enumerate(_iter_rows(tmp / "foundations.csv.gz")):
        if i == 0 and list(r.keys()) != by_kind["foundations"]["columns"]:
            raise RuntimeError(
                f"foundations.csv.gz columns {list(r.keys())} != the column dictionary")
        if r["getfunded_id"] in seen_ids:
            raise RuntimeError(
                f"foundations.csv.gz has two rows for foundation {r['getfunded_id']}")
        seen_ids.add(r["getfunded_id"])
        # The two rules for free text, checked on the bytes: no contact detail
        # inside a deadline text, and no "in care of" part left on a name.
        if _DEADLINE_CONTACT_RE.search(r["application_deadline_text"] or ""):
            raise RuntimeError(
                f"foundations.csv.gz row {i + 1}: application_deadline_text holds an email "
                "address or a phone number")
        if _NAME_CARE_OF_RE.search(r["name"] or ""):
            raise RuntimeError(
                f"foundations.csv.gz row {i + 1}: the name still has an \"in care of\" part")
        dataset_set.update(d for d in (r["source_dataset"] or "").split(";") if d)
        posture[r["application_posture"]] = posture.get(r["application_posture"], 0) + 1
        if "irs_standing" in r:
            key = r["irs_standing"] or "not_available"
            standing_counts[key] = standing_counts.get(key, 0) + 1
        if "address_basis" in r:
            if r["address_basis"] and r["address_basis"] not in ADDRESS_BASIS_VALUES:
                raise RuntimeError(
                    f"foundations.csv.gz row {i + 1}: address_basis {r['address_basis']!r} is "
                    f"not one of {', '.join(ADDRESS_BASIS_VALUES)}")
            key = r["address_basis"] or "no_address"
            address_counts[key] = address_counts.get(key, 0) + 1
    if standing_counts:
        option["irs_standing"]["irs_standing_counts"] = dict(sorted(standing_counts.items()))
    if address_counts:
        option["address_basis"]["address_basis_counts"] = dict(sorted(address_counts.items()))
    fy_set: set[int] = set()
    oid_year_set: set[int] = set()
    linked_in_years: dict[int, int] = {}
    for i, r in enumerate(_iter_rows(tmp / "foundation_years.csv.gz")):
        if i == 0 and list(r.keys()) != by_kind["foundation_years"]["columns"]:
            raise RuntimeError(
                f"foundation_years.csv.gz columns {list(r.keys())} != the column dictionary")
        if r["fiscal_year"]:
            fy_set.add(int(r["fiscal_year"]))
            if r["grants_linked_on_file"]:
                linked_in_years[int(r["fiscal_year"])] = (
                    linked_in_years.get(int(r["fiscal_year"]), 0)
                    + int(r["grants_linked_on_file"]))
        if r["filing_object_id"][:4].isdigit():
            oid_year_set.add(int(r["filing_object_id"][:4]))
    # link_basis is counted on the bytes of each grants file. Every key is
    # there, so a 0 is a counted zero. Without the column there are no counts.
    def no_basis_counts() -> dict[str, int]:
        return {**{v: 0 for v in LINK_BASIS_VALUES}, LINK_BASIS_EMPTY_KEY: 0}

    basis_counts = no_basis_counts() if use["link_basis"] else None
    grants_by_fy: dict[int, dict] = {}
    for f in files:
        if f["kind"] != GRANTS_KIND:
            continue
        grants_by_fy[f["fiscal_year"]] = f
        file_basis = no_basis_counts() if "link_basis" in f["columns"] else None
        for i, r in enumerate(_iter_rows(tmp / f["name"])):
            if i == 0 and list(r.keys()) != f["columns"]:
                raise RuntimeError(
                    f"{f['name']} columns {list(r.keys())} != the column dictionary")
            # The rule of the grants files, checked on the bytes: every row
            # names an organization record and belongs to this file's year.
            if not (r["recipient_getfunded_id"] and r["recipient_name"] and r["funder_ein"]):
                raise RuntimeError(
                    f"{f['name']} row {i + 1}: no linked organization record or no funder EIN")
            if r["fiscal_year"] != str(f["fiscal_year"]):
                raise RuntimeError(f"{f['name']} row {i + 1}: fiscal year {r['fiscal_year']}")
            if (_NAME_CARE_OF_RE.search(r["recipient_name"])
                    or _NAME_CARE_OF_RE.search(r["funder_name"] or "")):
                raise RuntimeError(
                    f"{f['name']} row {i + 1}: a name still has an \"in care of\" part")
            if file_basis is not None:
                if r["link_basis"] and r["link_basis"] not in LINK_BASIS_VALUES:
                    raise RuntimeError(
                        f"{f['name']} row {i + 1}: link_basis {r['link_basis']!r} is not one "
                        f"of {', '.join(LINK_BASIS_VALUES)}")
                file_basis[r["link_basis"] or LINK_BASIS_EMPTY_KEY] += 1
        if file_basis is not None:
            if sum(file_basis.values()) != f["rows"]:
                raise RuntimeError(
                    f"{f['name']}: link_basis was counted for {sum(file_basis.values()):,} "
                    f"rows, but the file has {f['rows']:,}")
            f["link_basis_counts"] = file_basis
            for key, n in file_basis.items():
                basis_counts[key] += n
    if basis_counts is not None:
        option["link_basis"]["link_basis_counts"] = basis_counts
        option["link_basis"]["link_basis_counts_note"] = (
            "rows of all grants files of this build; `not_available` counts the empty "
            "cells (grant rows from a Form 990). Each grants file has its own counts "
            "under `files`")
    datasets, fys, oid_years = sorted(dataset_set), sorted(fy_set), sorted(oid_year_set)

    by_year = []
    for y in coverage_years:
        fy, linked = y["fiscal_year"], y["linked"]
        f = grants_by_fy.get(fy)
        in_years = linked_in_years.get(fy, 0) if fy is not None else 0
        if in_years > linked:
            raise RuntimeError(
                f"fiscal year {fy}: foundation_years.csv.gz counts {in_years:,} linked "
                f"grant rows, more than the {linked:,} the database holds")
        by_year.append({
            "fiscal_year": fy,
            "grants_on_file": int(y["grants"]),
            "linked": int(linked),
            "not_linked": int(y["not_linked"]),
            "amount_linked": _money(y["amount_linked"]),
            "amount_not_linked": _money(y["amount_not_linked"]),
            "file": f["name"] if f else None,
            "rows_in_file": f["rows"] if f else 0,
            "linked_in_foundation_years": in_years,
            "linked_rows_recipient_name_cut": int(y["linked_recipient_name_cut"]),
        })
        if basis_counts is not None:
            # Counted on the rows of the file (a sample's file can be capped).
            by_year[-1]["link_basis_counts_in_file"] = f.get("link_basis_counts") if f else None
    coverage = {
        "rule": ("a grant row is in a grants file only when its recipient is linked to an "
                 "organization record that public.organizations shows; every other grant "
                 "row is counted and not named"),
        "linked_in_foundation_years_note": (
            "the sum of grants_linked_on_file for the fiscal year; it is less than "
            "`linked` when a return's grant rows are loaded and its financial data is not"),
        "by_fiscal_year": by_year,
        "totals": {
            "grants_on_file": sum(y["grants_on_file"] for y in by_year),
            "linked": sum(y["linked"] for y in by_year),
            "not_linked": sum(y["not_linked"] for y in by_year),
            "rows_in_files": sum(y["rows_in_file"] for y in by_year),
        },
        "recipient_source_datasets": recipient_datasets,
        "recipient_source_datasets_note": (
            "linked grant rows, by the source dataset of the organization record the "
            "recipient is linked to"),
    }
    if basis_counts is not None:
        coverage["link_basis_counts"] = basis_counts

    withheld = {
        "grant_purpose": {
            "published": False,
            "note": ("the purpose text of a grant is not in this release; it can name a "
                     "private person. It is on the funder's profile page. A later release "
                     "can add it after a privacy review"),
        },
        "application_deadline_text": {
            "blanked": deadlines_blanked,
            "rule": ("written as empty when the filed text holds an email address or a "
                     "phone number"),
            "patterns": list(DEADLINE_CONTACT_PATTERNS),
        },
        "names": {
            "foundation_names_cut": names_cut,
            "linked_grant_rows_recipient_name_cut": sum(
                y["linked_rows_recipient_name_cut"] for y in by_year),
            "rule": ("a name is cut before an \"in care of\" part: a space, then C/O, % or "
                     "IN CARE OF, then a name. The database keeps the registry name"),
            "pattern": NAME_CARE_OF_PATTERN,
            "grant_rows_note": ("the grant row count is for every linked grant row of the "
                                "foundations in scope; a sample's grants files can hold "
                                "fewer rows. funder_name is cut by the same rule and is "
                                "not counted for each row: it is the name in "
                                "foundations.csv.gz"),
        },
    }

    manifest = {
        "dataset": "open-foundation-list",
        "vintage": vintage,
        "generated_at": generated.isoformat(),
        "limit": limit,
        "grants_row_cap": row_cap,
        "generator": {
            "tool": "funderdb export foundations",
            "git_commit": git_commit(),
            "git_commit_note": "HEAD as recorded in .git; uncommitted edits are not reflected",
            "statement_timeout": timeout,
            "snapshot": "every file was read in one read-only REPEATABLE READ transaction",
            "application_name": APPLICATION_NAME,
            "statement_seconds": timings,
            "total_seconds": total_seconds,
        },
        "license": {
            "compilation": LICENCE_NAME, "url": LICENSE_URL, "attribution": ATTRIBUTION,
            "compilation_scope": "the selection, the arrangement and the derived columns",
            "underlying_records": ("public records released by the U.S. Government; facts "
                                   "are not subject to copyright and this licence does not "
                                   "restrict them"),
        },
        "source_views": list(allowed),
        "optional_columns": optional,
        "source_datasets": datasets,
        "index_years_covered": oid_years,
        "index_years_method": ("the year at the start of each exported filing's IRS "
                               "OBJECT_ID in foundation_years.csv.gz, which is the index "
                               "year for 2021 and later"),
        "fiscal_years": {"first": fys[0] if fys else None, "last": fys[-1] if fys else None},
        "application_posture_counts": posture,
        "grants_coverage": coverage,
        "withheld": withheld,
        "boundary_checks": checks,
        "preflight_checks": preflight,
        "preflight_ignored": preflight_ignored,
        "files": files,
        "row_count_method": "csv records (quoted newlines are field content), header excluded",
    }
    (tmp / "LICENSE.txt").write_text(_license_text(), encoding="utf-8")
    (tmp / "README.md").write_text(_readme(manifest), encoding="utf-8")
    publish(tmp, final, manifest)
    echo(f"  published {final}")

    if no_ledger:
        echo("  --no-ledger: the run was not registered in raw_files or the ledger")
    else:
        with connect() as conn:
            staged = staging.stage_local(DATASET, final / "manifest.json")
            rfid = staging.register_raw_file(
                conn, staged, license_code="cc_by", content_type="application/json")
            conn.commit()
            run_id = ledger.start_run(conn, rfid, DATASET)
            ledger.complete_run(
                conn, run_id, inserted=sum(x["rows"] for x in files),
                notes=f"open foundation list {vintage}: "
                      + ", ".join(f"{x['name']} {x['rows']:,} rows" for x in files))

    if release_json is not None:
        write_release_json(release_json, manifest, tag)
        echo(f"  wrote {release_json} (release {tag})")
        if limit:
            echo("  NOTE: this release JSON describes a SAMPLE made with --limit. "
                 "Do not publish it.")
    return manifest

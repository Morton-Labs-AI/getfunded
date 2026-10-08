"""The Open Foundation List: a small public file anyone can download.

`funderdb export public` publishes every public view, 47M rows in 55 files.
Most people who want "a list of U.S. private foundations" need two small
files instead:

    foundations.csv.gz        one row per private foundation
    foundation_years.csv.gz   one row per foundation per fiscal year

This module writes them, with a README, a LICENSE and a manifest, into
``DIR/<vintage>/`` using the same publication pattern as export.py: files go
into a temporary folder, ``manifest.json`` is written last, the folder is
renamed into place, then ``LATEST`` is updated.

The licence boundary is structural, not a promise. Both queries read ONLY the
republishable surface, the ``public.*`` views, and only the seven listed in
ALLOWED_VIEWS. Before a byte is written the module checks that:

* every output column declares a source view and that view is allowed;
* every relation either query reads is an allowed view or one of the query's
  own CTEs, and no other schema is named anywhere in the SQL;
* each allowed view really is a view in schema ``public`` and has the columns
  the queries use;
* the two contact columns come from ``public.contact_channels`` and from
  nothing else, and the views that carry as-filed contact details
  (``public.filing_application_info``) are not read at all.

One failed check aborts with a nonzero exit and no files.

Honesty rules the files obey (the README repeats them for readers):

* ``not_stated`` is not closed. It means the latest parsed return says
  nothing about applications, or no return is on file.
* Empty means not available. A missing number is empty, never 0. Counts are
  empty too when nothing is on file, so a 0 is always a filed zero.
* ``latest_*`` values come from the latest PARSED, unsuperseded return.

Determinism: server-side COPY with a total ORDER BY (ein, then id), timezone
and DateStyle pinned, gzip with mtime 0 and an empty filename. The same
database gives the same bytes.
"""

from __future__ import annotations

import csv
import gzip
import io
import re
from datetime import datetime, timezone
from pathlib import Path

from . import ledger, staging
from .db import connect
from .export import _clean_stale_tmp, _write_csv_gz, publish, vintage_label

DATASET = "export_foundations"
PROFILE_URL = "https://getfunded.ai/funder/"
ATTRIBUTION = "Open Funder Database contributors (GetFunded), from IRS e-file data"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"

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
CONTACT_VIEW = "public.contact_channels"
CONTACT_COLUMNS = ("public_contact_email", "public_contact_phone")

# Values a filer writes in the "how to apply" box when there is nothing to say.
_NO_INSTRUCTIONS = ("N/A", "NA", "N.A.", "NONE", "NOT APPLICABLE", "NULL", "X")

# ---------------------------------------------------------------------------
# Column dictionaries: (column, source view(s), meaning). The source views are
# checked against ALLOWED_VIEWS before the export runs; the meanings become
# the README's column dictionary, so the documentation cannot drift from the
# file.
# ---------------------------------------------------------------------------
FOUNDATION_COLUMNS: list[tuple[str, tuple[str, ...], str]] = [
    ("getfunded_id", ("public.organizations",),
     "Stable id of the foundation in this database (a UUID)."),
    ("ein", ("public.org_identifiers",),
     "IRS Employer Identification Number, 9 digits, with leading zeros."),
    ("name", ("public.organizations",), "Name as the IRS master file or the return gives it."),
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
     "Submission deadlines, exactly as filed."),
    ("public_contact_email", ("public.contact_channels",),
     "A role inbox (such as grants@) the foundation printed for applicants. "
     "Addresses of named people are never published."),
    ("public_contact_phone", ("public.contact_channels",),
     "The phone number the foundation printed for applicants, as +1XXXXXXXXXX."),
    ("latest_filing_object_id", ("public.org_financial_series",),
     "IRS OBJECT_ID of the return the latest_* columns come from."),
    ("latest_filing_tax_period", ("public.org_financial_series",),
     "Tax period of that return, YYYYMM (the month the fiscal year ended)."),
    ("source_dataset", ("public.organizations", "public.filings", "public.funding_events",
                        "public.org_application_posture", "public.contact_channels"),
     "The source datasets this row draws on, separated by `;`."),
    ("profile_url", ("public.organizations",), "The foundation's page on getfunded.ai."),
]

YEAR_COLUMNS: list[tuple[str, tuple[str, ...], str]] = [
    ("ein", ("public.org_identifiers",), "IRS Employer Identification Number."),
    ("getfunded_id", ("public.organizations",), "Same id as in foundations.csv.gz."),
    ("fiscal_year", ("public.org_financial_series",),
     "The year in which the fiscal year ended."),
    ("tax_period_end", ("public.org_financial_series",), "Last day of the fiscal year."),
    ("return_type", ("public.org_financial_series",), "`990PF` or `990`."),
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
     "Which of the two lines grants_paid is."),
    ("n_grants_on_file", ("public.funding_events",),
     "Grant rows this database holds for that foundation and fiscal year. "
     "Empty when it holds none."),
    ("filing_object_id", ("public.org_financial_series",),
     "IRS OBJECT_ID of the return."),
]


def _pf_cte(limit: int | None) -> str:
    """The foundations in scope: every private foundation with an EIN, lowest
    EIN first. ``limit`` keeps the first N (a sample for checking)."""
    return f"""pf as (
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

_GRANTS_PAID = "coalesce({a}.qualifying_distributions, {a}.charitable_disbursements)"
_GRANTS_BASIS = ("case when {a}.qualifying_distributions is not null "
                 "then 'qualifying_distributions' "
                 "when {a}.charitable_disbursements is not null "
                 "then 'charitable_disbursements' end")


def foundations_sql(limit: int | None = None) -> str:
    junk = ", ".join(f"'{j}'" for j in _NO_INSTRUCTIONS)
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
  where e.event_type = 'grant'
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
)
select
  o.id as getfunded_id,
  pf.ein,
  o.name, o.city, o.state, o.zip, o.ntee_code,
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
  p.submission_deadlines_txt as application_deadline_text,
  contact.email as public_contact_email,
  contact.phone as public_contact_phone,
  latest.object_id as latest_filing_object_id,
  latest.tax_period as latest_filing_tax_period,
  (select string_agg(d, ';' order by d)
   from (select distinct unnest(
           array[o.source_dataset, latest_filing.source_dataset, p.source_dataset]
           || coalesce(grants.datasets, '{{}}') || coalesce(contact.datasets, '{{}}')) as d) x
   where d is not null) as source_dataset,
  '{PROFILE_URL}' || o.id::text as profile_url
from pf
join public.organizations o on o.id = pf.org_id
left join span on span.org_id = pf.org_id
left join latest on latest.org_id = pf.org_id
left join latest_filing on latest_filing.org_id = pf.org_id
left join grants on grants.org_id = pf.org_id
left join site on site.org_id = pf.org_id
left join contact on contact.org_id = pf.org_id
left join public.org_application_posture p on p.org_id = pf.org_id
order by pf.ein, o.id"""


def years_sql(limit: int | None = None) -> str:
    return f"""with {_pf_cte(limit)},
{_FIN_CTE},
grants as (
  select e.funder_org_id as org_id, e.fiscal_year, count(*) as n
  from public.funding_events e
  join pf on pf.org_id = e.funder_org_id
  where e.event_type = 'grant' and e.fiscal_year is not null
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
  fin.object_id as filing_object_id
from pf
join public.organizations o on o.id = pf.org_id
join fin on fin.org_id = pf.org_id
left join grants on grants.org_id = pf.org_id and grants.fiscal_year = fin.fy
order by pf.ein, o.id, fin.fy"""


# ---------------------------------------------------------------------------
# Boundary checks
# ---------------------------------------------------------------------------
_CTE_NAME = re.compile(r"(?:\bwith|,)\s*(\w+)\s+as\s*\(", re.I)
_RELATION = re.compile(r"\b(?:from|join)\s+([a-z_][\w.]*)", re.I)
_SCHEMAS = ("internal", "information_schema", "pg_catalog", "extensions", "auth", "vault")


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


def static_checks(queries: dict[str, str]) -> list[dict]:
    """Boundary checks that need no database: they read the column dictionaries
    and the SQL text itself."""
    out: list[dict] = []

    def add(aid: str, statement: str, problems: list[str]) -> None:
        out.append({"id": aid, "statement": statement,
                    "result": "PASS" if not problems else "FAIL", "problems": problems})

    declared = [(c, v) for c, views, _ in FOUNDATION_COLUMNS + YEAR_COLUMNS for v in views]
    add("F1", "every output column declares a source view and it is an allowed public view",
        sorted({f"{c} <- {v}" for c, v in declared if v not in ALLOWED_VIEWS}))

    bad_rel = []
    for qname, sql in queries.items():
        bad_rel += [f"{qname}: {r}" for r in sorted(relations_read(sql))
                    if r not in ALLOWED_VIEWS]
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
    for c, views, _ in FOUNDATION_COLUMNS + YEAR_COLUMNS:
        if c in CONTACT_COLUMNS and views != (CONTACT_VIEW,):
            contact_problems.append(f"{c} declares {views}")
    fsql = queries["foundations"]
    body_rels = relations_read("with x as (select 1) " + cte_body(fsql, "contact")) - {"pf"}
    if body_rels != {CONTACT_VIEW}:
        contact_problems.append(f"contact CTE reads {sorted(body_rels)}")
    for col, src in (("public_contact_email", "contact.email"),
                     ("public_contact_phone", "contact.phone")):
        if not re.search(rf"\b{re.escape(src)}\s+as\s+{col}\b", fsql):
            contact_problems.append(f"{col} is not selected from {src}")
    # No other alias may yield an email or phone value (public.filings has a
    # filer phone column; it must never reach this file).
    for m in re.finditer(r"\b(\w+)\.(email|phone)\b", fsql, re.I):
        if m.group(1).lower() != "contact":
            contact_problems.append(f"{m.group(0)} is read outside the contact CTE")
    if re.search(r"\b(email|phone)\b", queries["foundation_years"], re.I):
        contact_problems.append("foundation_years names an email or phone column")
    add("F4", f"contact columns come only from {CONTACT_VIEW}", contact_problems)
    return out


_VIEW_COLUMNS_USED = {
    "public.organizations": ("id", "name", "city", "state", "zip", "ntee_code", "ruling_date",
                             "org_type", "source_dataset"),
    "public.org_identifiers": ("org_id", "id_type", "id_value"),
    "public.org_application_posture": ("org_id", "application_posture", "has_part_xv",
                                       "form_and_info_txt", "submission_deadlines_txt",
                                       "source_dataset"),
    "public.org_financial_series": ("org_id", "fy", "tax_period", "tax_period_end",
                                    "return_type", "object_id", "total_revenue",
                                    "total_expenses", "total_assets_eoy", "net_assets_eoy",
                                    "qualifying_distributions", "charitable_disbursements"),
    "public.filings": ("object_id", "org_id", "tax_period", "website",
                       "superseded_by_object_id", "source_dataset"),
    "public.funding_events": ("funder_org_id", "event_type", "amount", "fiscal_year",
                              "source_dataset"),
    "public.contact_channels": ("org_id", "channel_type", "value", "source_dataset"),
}


def database_checks(cur) -> list[dict]:
    """Each allowed relation is a view in schema public and has the columns
    the queries use. Reads the catalog only."""
    cur.execute("select table_name from information_schema.views where table_schema = 'public'")
    views = {r[0] for r in cur.fetchall()}
    missing = [v for v in ALLOWED_VIEWS if v.split(".", 1)[1] not in views]
    cur.execute("select table_name, column_name from information_schema.columns "
                "where table_schema = 'public'")
    have: dict[str, set[str]] = {}
    for t, c in cur.fetchall():
        have.setdefault(t, set()).add(c)
    absent = [f"{v}.{c}" for v, cols in _VIEW_COLUMNS_USED.items() for c in cols
              if c not in have.get(v.split(".", 1)[1], set())]
    return [
        {"id": "F5", "statement": "every relation read is a view in schema public",
         "result": "PASS" if not missing else "FAIL", "problems": missing},
        {"id": "F6", "statement": "every column the queries use exists on its public view",
         "result": "PASS" if not absent else "FAIL", "problems": absent},
    ]


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


def _license_text() -> str:
    return f"""Open Foundation List

THE COMPILATION
The selection, arrangement and derived columns of these files are licensed
under the Creative Commons Attribution 4.0 International licence (CC BY 4.0):

    {LICENSE_URL}

You may copy, share and adapt the files for any purpose, including commercial
use, when you give credit. Use this credit line:

    {ATTRIBUTION}

THE UNDERLYING RECORDS
The facts come from records of the U.S. Internal Revenue Service: Form 990-PF
and Form 990 e-file data and the Exempt Organizations Business Master File.
These are works of the U.S. Government and are in the public domain. No
credit is required for them, and this licence does not restrict them.

NO WARRANTY
The files are provided as they are. They can contain errors made by the
filers, by the IRS, or by this project. Check the original return before you
rely on a figure.
"""


def _dictionary(columns: list[tuple[str, tuple[str, ...], str]]) -> str:
    lines = ["| Column | Meaning |", "|---|---|"]
    lines += [f"| `{c}` | {meaning} |" for c, _views, meaning in columns]
    return "\n".join(lines)


def _readme(m: dict) -> str:
    f = {x["name"]: x for x in m["files"]}
    sample = (f"\n> This is a SAMPLE of the first {m['limit']:,} foundations by EIN, "
              "made with `--limit`. It is not the full list.\n" if m["limit"] else "")
    years = m["fiscal_years"]
    return f"""# Open Foundation List — {m['vintage']}
{sample}
A list of U.S. private foundations, built only from public IRS records.
Anyone can download it, use it and share it.

## The files

| File | What it is | Rows |
|---|---|---|
| `foundations.csv.gz` | One row for each private foundation. | {f['foundations.csv.gz']['rows']:,} |
| `foundation_years.csv.gz` | One row for each foundation and fiscal year. | {f['foundation_years.csv.gz']['rows']:,} |
| `manifest.json` | Row counts, sha256 of each file, sources, how it was built. | |
| `LICENSE.txt` | The licence and the credit line. | |

The CSV files are gzip files. Excel, Google Sheets, R, pandas and DuckDB can
open them. The text is UTF-8. The first line has the column names. The rows
are sorted by `ein`.

Fiscal years in these files: {years['first'] or 'none'} to {years['last'] or 'none'}.

## How to read the files honestly

1. **`not_stated` is not closed.** `application_posture` is `not_stated` when
   the latest return says nothing about applications, or when no return is on
   file. It does not mean the foundation refuses applications.
2. **Empty means not available.** An empty cell means this database does not
   have the value. It does not mean zero. A `0` is a zero that the foundation
   filed.
3. **`grants_on_file` counts what this database holds.** It is not the number
   of grants the foundation made. It is empty when the database holds no grant
   rows for the foundation.
4. **`latest_grants_paid` is one of two lines.** The column
   `latest_grants_paid_basis` says which one. Qualifying distributions include
   some costs of giving, not only grants.
5. **The latest values come from the latest parsed return.** A newer return
   can exist at the IRS that is not in the bulk data yet.
6. **Amended returns replace the original.** Only the newest return for a
   fiscal year is used.
7. **Contacts are limited on purpose.** `public_contact_email` is only a role
   inbox that the foundation printed for applicants, such as `grants@`.
   The address of a named person is never published.
8. **The return is the source.** Filers make mistakes. Use
   `latest_filing_object_id` to find the original return at the IRS.

## Columns of `foundations.csv.gz`

{_dictionary(FOUNDATION_COLUMNS)}

## Columns of `foundation_years.csv.gz`

{_dictionary(YEAR_COLUMNS)}

If a foundation filed two returns that end in the same calendar year, the
file keeps the return with the later end date.

## How to cite

> {ATTRIBUTION}. Open Foundation List, version {m['vintage']}.

The compilation is CC BY 4.0. The IRS records are in the public domain.
See `LICENSE.txt`.

## Known limits

- Only returns filed electronically are in the IRS bulk data. Paper returns
  are not.
- The IRS publishes returns in batches. Some returns are listed by the IRS
  before their data is published.
- Years on file depend on which IRS index years this database has loaded:
  {', '.join(str(y) for y in m['index_years_covered']) or 'none'}.
- Name, address, NTEE code and ruling year come from the IRS master file. It
  can be up to two years behind.
- Grant rows are as the foundation typed them. Recipient names are not
  cleaned in this file.
- A foundation with no EIN in the database is not in the list.

## How it was built

Every value comes from a `public.*` view of the Open Funder Database. Those
views show only records that may be republished. The export checks this
before it writes a file. The checks and their results are in `manifest.json`.

To build it again from the same database:

```
uv run funderdb export foundations --out DIR
```

The same database gives the same files, byte for byte. Compare the sha256
values in `manifest.json` to check a copy.

To report an error, name the return (its `latest_filing_object_id`) or the
public record that shows the right value.
"""


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------
def run(out_dir: Path, *, limit: int | None = None, no_ledger: bool = False,
        statement_timeout: str | None = None, echo=print) -> dict:
    """Write ``out_dir/<vintage>/``. ``statement_timeout`` defaults to 20s for a
    ``limit`` sample (the cap of the app's read-only role, so a sample proves
    the queries are cheap) and to 60min for the full list."""
    if limit is not None and limit <= 0:
        raise ValueError("--limit must be a positive number")
    timeout = statement_timeout or ("20s" if limit else "60min")
    queries = {"foundations": foundations_sql(limit), "foundation_years": years_sql(limit)}

    def session(conn):
        conn.read_only = True     # this export never writes through this session
        cur = conn.cursor()
        cur.execute(f"set local statement_timeout = '{timeout}'")
        cur.execute("set local timezone = 'UTC'")
        cur.execute("set local datestyle = 'ISO, MDY'")
        return cur

    checks = static_checks(queries)
    with connect() as conn:
        with session(conn) as cur:
            checks += database_checks(cur)
        conn.rollback()
    for c in checks:
        echo(f"  {c['result']} {c['id']}  {c['statement']}"
             + (f"  -> {'; '.join(c['problems'][:6])}" if c["problems"] else ""))
    if any(c["result"] == "FAIL" for c in checks):
        raise SystemExit("\nBOUNDARY VIOLATION — a check failed. No files written.")

    generated = datetime.now(timezone.utc).replace(microsecond=0)
    vintage = vintage_label(generated)
    out_dir.mkdir(parents=True, exist_ok=True)
    _clean_stale_tmp(out_dir, echo=echo)
    tmp, final = out_dir / f".tmp-{vintage}", out_dir / vintage
    tmp.mkdir()
    echo(f"  writing {tmp} (published as {final.name} on success)")

    files: list[dict] = []
    for stem, columns in (("foundations", FOUNDATION_COLUMNS),
                          ("foundation_years", YEAR_COLUMNS)):
        with connect() as conn:
            with session(conn) as cur:
                meta = _write_csv_gz(cur, queries[stem], tmp / f"{stem}.csv.gz")
            conn.rollback()
        meta["columns"] = [c for c, _v, _m in columns]
        meta["views"] = sorted({v for _c, views, _m in columns for v in views})
        meta["order_by"] = "ein" if stem == "foundations" else "ein, fiscal_year"
        files.append(meta)
        echo(f"  {meta['rows']:>10,}  {meta['name']}")

    # Facts about what was written, read back from the files themselves so the
    # manifest describes the bytes, not the intention.
    dataset_set: set[str] = set()
    posture = {"accepts_applications": 0, "preselected_only": 0, "not_stated": 0}
    for i, r in enumerate(_iter_rows(tmp / "foundations.csv.gz")):
        if i == 0 and list(r.keys()) != files[0]["columns"]:
            raise RuntimeError(
                f"foundations.csv.gz columns {list(r.keys())} != the column dictionary")
        dataset_set.update(d for d in (r["source_dataset"] or "").split(";") if d)
        posture[r["application_posture"]] = posture.get(r["application_posture"], 0) + 1
    fy_set: set[int] = set()
    oid_year_set: set[int] = set()
    for i, r in enumerate(_iter_rows(tmp / "foundation_years.csv.gz")):
        if i == 0 and list(r.keys()) != files[1]["columns"]:
            raise RuntimeError(
                f"foundation_years.csv.gz columns {list(r.keys())} != the column dictionary")
        if r["fiscal_year"]:
            fy_set.add(int(r["fiscal_year"]))
        if r["filing_object_id"][:4].isdigit():
            oid_year_set.add(int(r["filing_object_id"][:4]))
    datasets, fys, oid_years = sorted(dataset_set), sorted(fy_set), sorted(oid_year_set)

    manifest = {
        "dataset": "open-foundation-list",
        "vintage": vintage,
        "generated_at": generated.isoformat(),
        "limit": limit,
        "generator": {
            "tool": "funderdb export foundations",
            "git_commit": git_commit(),
            "git_commit_note": "HEAD as recorded in .git; uncommitted edits are not reflected",
            "statement_timeout": timeout,
        },
        "license": {
            "compilation": "CC BY 4.0", "url": LICENSE_URL, "attribution": ATTRIBUTION,
            "underlying_records": "U.S. Government works (IRS), public domain",
        },
        "source_views": list(ALLOWED_VIEWS),
        "source_datasets": datasets,
        "index_years_covered": oid_years,
        "index_years_method": ("the year at the start of each exported filing's IRS "
                               "OBJECT_ID, which is the index year for 2021 and later"),
        "fiscal_years": {"first": fys[0] if fys else None, "last": fys[-1] if fys else None},
        "application_posture_counts": posture,
        "boundary_checks": checks,
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
    return manifest

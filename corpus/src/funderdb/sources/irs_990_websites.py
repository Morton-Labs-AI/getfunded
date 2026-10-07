"""Filer-stated websites from staged IRS 990/990-PF XML — a header-field pass.

WebsiteAddressTxt locations (verified against real filings 2026-08-10):
  Form 990:    ReturnData/IRS990/WebsiteAddressTxt          (direct child)
  Form 990-PF: ReturnData/IRS990PF/StatementsRegardingActyGrp/WebsiteAddressTxt

First-party us_public_domain data: the filer states its own website on a
public filing. The republishable counterpart to the publisher_website scrape
license — it may flow to public views and the CC-BY export.

Most raw values are junk ("N/A" alone appears 3,215 times in one 2026 batch
zip); normalize_website() is the gate, and it is deliberately conservative —
a wrong website on a profile is worse than a missing one. NULL means "no
usable website stated"; website_parsed_at stamps the attempt either way, so
the pass is idempotent over internal.filings (return_type in ('990','990PF'),
both form types in one sweep since the batch zips interleave them).

Never downloads batch zips, never touches grant rows, never touches
embeddings (search-document doc_text does not include the website).
"""

from __future__ import annotations

import re
from collections import defaultdict

from lxml import etree

from .. import ledger
from ..db import connect
from .irs_990pf import (
    NS,
    PfFiling,
    _iter_wanted_members,
    _raw_file_id_for_zip,
    _staged_zip,
    batch_ids_for,
    load_index,
)

# Ordered by expected hit rate; first non-empty text wins. The bare-IRS990PF
# path guards against schema years that hoist the element out of the Part
# VII-A group. No global fallback — precision over recall.
_PATHS = (
    f"{NS}ReturnData/{NS}IRS990/{NS}WebsiteAddressTxt",
    f"{NS}ReturnData/{NS}IRS990PF/{NS}StatementsRegardingActyGrp/{NS}WebsiteAddressTxt",
    f"{NS}ReturnData/{NS}IRS990PF/{NS}WebsiteAddressTxt",
)

# Exact-match rejects, tested after uppercasing and trimming ./ from the ends.
# Whitespace-bearing junk ("NOT APPLICABLE", "SEE SCHEDULE O") never reaches
# this set — any interior whitespace is rejected first.
_JUNK = {
    "N/A", "NA", "N-A", "NONE", "NULL", "NO", "NON", "N/A.", "WWW",
    "HTTP", "HTTPS", "TBD", "UNKNOWN", "PENDING", "SAME", "X", "XX", "XXX",
    "NOWEBSITE", "NOTAPPLICABLE",
}

_HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")


def normalize_website(raw: str | None) -> str | None:
    """Normalized URL or None. Lowercases (990 values are commonly ALL CAPS),
    defaults the scheme to https, requires a plausible dotted host with an
    alphabetic TLD, rejects e-mail addresses, ports, and interior whitespace."""
    if not raw:
        return None
    s = raw.strip().rstrip(",;")
    if not s or len(s) > 200 or any(c.isspace() for c in s):
        return None
    if s.upper().strip("./") in _JUNK:
        return None
    if "@" in s:  # an e-mail address in the website box
        return None
    s = s.lower()
    scheme = "https"
    for pre in ("https://", "http://"):
        if s.startswith(pre):
            scheme = pre.split(":", 1)[0]
            s = s[len(pre):]
            break
    s = s.lstrip("/")
    host, _, path = s.partition("/")
    host = host.rstrip(".")
    if ":" in host:  # ports and scheme typos ("http:www.x.org")
        return None
    if not _HOST_RE.match(host):
        return None
    tld = host.rsplit(".", 1)[-1]
    if not tld.isalpha() or len(tld) < 2:
        return None
    path = path.rstrip("/")
    return f"{scheme}://{host}" + (f"/{path}" if path else "")


def extract_raw(data: bytes) -> str | None:
    """Raw WebsiteAddressTxt text from one filing XML, or None if absent."""
    root = etree.fromstring(data)
    for p in _PATHS:
        el = root.find(p)
        if el is not None and el.text and el.text.strip():
            return el.text.strip()
    return None


def _todo_map(conn, year: int) -> dict[str, PfFiling]:
    """This year's index rows (both form types) still needing the pass."""
    idx = load_index(year, return_type="990") + load_index(year, return_type="990PF")
    with conn.cursor() as cur:
        cur.execute("""
            select object_id from internal.filings
            where return_type in ('990','990PF') and website_parsed_at is null""")
        todo = {r[0] for r in cur.fetchall()}
    return {f.object_id: f for f in idx if f.object_id in todo}


def _write_batch(conn, oids: list[str], sites: list[str | None]) -> int:
    """Stamp one zip's results. NULL website + a timestamp = parsed, nothing
    usable stated — the row is never revisited."""
    if not oids:
        return 0
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute("""
            update internal.filings f
               set website = v.website,
                   website_parsed_at = now()
              from (select unnest(%(oids)s::text[]) as object_id,
                           unnest(%(sites)s::text[]) as website) v
             where f.object_id = v.object_id""",
            {"oids": oids, "sites": sites})
        n = cur.rowcount
    conn.commit()
    return n


def ingest(years: tuple[int, ...] = (2026, 2025, 2024, 2023, 2022, 2021)) -> dict:
    """Website pass over ALREADY-STAGED zips, newest-first, one transaction
    and one ledger run per zip. Idempotent via filings.website_parsed_at."""
    totals: dict[str, int] = defaultdict(int)
    with connect() as conn:
        for year in years:
            remaining = _todo_map(conn, year)
            totals[f"todo_{year}"] = len(remaining)
            for batch_id in batch_ids_for(year, list(remaining.values())):
                if not remaining:
                    break
                path = _staged_zip(batch_id)
                if path is None:
                    totals["zips_not_staged"] += 1
                    continue
                todo = list(remaining.values())
                raw_file_id = _raw_file_id_for_zip(conn, path, year, batch_id)
                run_id = ledger.start_run(conn, raw_file_id, "irs_990_xml")
                try:
                    oids: list[str] = []
                    sites: list[str | None] = []
                    zc: dict[str, int] = defaultdict(int)
                    for f, data in _iter_wanted_members(path, todo, totals):
                        try:
                            raw = extract_raw(data)
                        except etree.XMLSyntaxError:
                            raw = None
                            zc["xml_errors"] += 1
                        site = normalize_website(raw)
                        oids.append(f.object_id)
                        sites.append(site)
                        zc["stated"] += 1 if raw else 0
                        zc["usable"] += 1 if site else 0
                    written = _write_batch(conn, oids, sites)
                    ledger.complete_run(
                        conn, run_id, updated=written,
                        notes=f"{batch_id} websites: parsed={len(oids)} "
                              f"stated={zc['stated']} usable={zc['usable']} "
                              f"xml_errors={zc['xml_errors']}")
                    for oid in oids:
                        remaining.pop(oid, None)
                    totals["filings_parsed"] += len(oids)
                    totals["websites_stated"] += zc["stated"]
                    totals["websites_usable"] += zc["usable"]
                    totals["xml_errors"] += zc["xml_errors"]
                    print(f"{batch_id}: parsed={len(oids):,} "
                          f"stated={zc['stated']:,} usable={zc['usable']:,}",
                          flush=True)
                except Exception as exc:
                    try:
                        conn.rollback()
                        ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                    except Exception:
                        pass
                    raise
            totals[f"pending_after_{year}"] = len(remaining)
    return dict(totals)


def dry_run(years: tuple[int, ...] = (2026,), limit: int | None = None) -> dict:
    """Yield measurement, no writes: how many filings state a website at all,
    and how many survive normalize_website(). Prints a sample of survivors.
    Sets the F8 floor honestly — run before the first real ingest."""
    totals: dict[str, int] = defaultdict(int)
    sample: list[str] = []
    with connect() as conn:
        for year in years:
            remaining = _todo_map(conn, year)
            totals[f"todo_{year}"] = len(remaining)
            for batch_id in batch_ids_for(year, list(remaining.values())):
                if limit and totals["parsed"] >= limit:
                    break
                path = _staged_zip(batch_id)
                if path is None:
                    totals["zips_not_staged"] += 1
                    continue
                todo = list(remaining.values())
                for f, data in _iter_wanted_members(path, todo, totals):
                    if limit and totals["parsed"] >= limit:
                        break
                    try:
                        raw = extract_raw(data)
                    except etree.XMLSyntaxError:
                        totals["xml_errors"] += 1
                        continue
                    totals["parsed"] += 1
                    if raw:
                        totals["stated"] += 1
                        site = normalize_website(raw)
                        if site:
                            totals["usable"] += 1
                            if len(sample) < 25:
                                sample.append(f"{raw!r} -> {site}")
                        else:
                            totals["rejected_junk"] += 1
                    remaining.pop(f.object_id, None)
    for line in sample:
        print(f"  {line}", flush=True)
    if totals["parsed"]:
        totals["stated_pct"] = round(100 * totals["stated"] / totals["parsed"], 1)
        totals["usable_pct"] = round(100 * totals["usable"] / totals["parsed"], 1)
    return dict(totals)

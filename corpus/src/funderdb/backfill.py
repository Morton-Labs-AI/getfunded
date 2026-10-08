"""Backfill older IRS index years, one zip at a time, on a small disk.

`funderdb ingest 990pf` and its sister commands work a year at a time and keep
every zip they download: fine for the newest years, impossible for a backfill
on a machine with a few GB free. This module does the same loads with the same
parsers and the same SQL, but in a different order:

    for each year, newest first
        make sure the filing spine for that year's index is loaded
        for each zip of that year
            skip it if the ledger already says "complete"
            refuse to start if the download would leave too little disk
            stage it (resume + sha256) and register it in raw_files
            load everything wanted from it in ONE pass over the archive:
              990-PF grants, financials, officers, Schedule B, Part XV,
              filer website (and, with --forms 990pf,990, Form 990 core
              financials and Schedule I grants)
            write one "backfill:" ledger row for the zip
            with --discard-zips: note the discard in raw_files.meta, then
              delete the local copy (row, sha256 and source URL stay)
        run the amended-return sweep for the groups that year touched
    print the follow-up commands (or run them with --finish)

Nothing here parses XML or writes fact rows itself. Parsing is
irs_990pf.parse_filing, irs_990_sched_i.parse_filing_990,
irs_990_detail.parse_filing_990_detail and irs_990_websites.extract_raw;
loading is their `_load_batch` / `_load_details` / `_write_batch`; the sweep is
irs_filings.reconcile. That is what keeps the backfill idempotent in the same
way the ingest commands are: every insert is `on conflict do nothing` on a
source key, and a filing whose markers are set is not opened again.

Two facts about the 2017-2020 files shaped the design (measured 2026-10-08,
see docs/DATA-SOURCES.md):

* A zip holds returns by object-id year, not by index year. Each zip is
  therefore offered the pending filings of its own index year AND the next
  one (`index_years_for`).
* The 2020 zips hold about 47,750 990-PF returns that are in no index CSV.
  They are real returns, mostly for fiscal 2019. By default they are loaded
  too: the spine row is read from the return's own header
  (irs_990pf.filing_from_header) with the zip as its raw file. `--indexed-only`
  turns that off.
"""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
import json
import re
import shutil
import time
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx
from lxml import etree

from . import ledger, staging
from .config import get_settings
from .sources import irs_990_detail, irs_990_sched_i, irs_990_websites, irs_990pf, irs_filings
from .sources.irs_990pf import Parsed, PfFiling

DATASET = irs_990pf.DATASET
LISTING_URL = "https://www.irs.gov/charities-non-profits/form-990-series-downloads"
DEFAULT_YEARS = (2020, 2019, 2018, 2017)

# CLI spelling -> the form name the index and the spine use.
FORMS = {"990pf": "990PF", "990": "990"}

# Every completed zip gets one ledger row whose notes start with this mark.
# The resume check reads it back; nothing else writes notes that start so.
LEDGER_MARK = "backfill:"

CHUNK = 5000        # filings per transaction — the size the ingest loaders use
GB = 1e9            # decimal, like `funderdb doctor`
_HEAD_PAUSE = 0.4   # seconds between requests to the IRS host (be polite)

# The passes one filing can still need. A pass is skipped when its marker in
# internal.filings is already set, which is what makes a re-run add nothing.
PASS_PF = "pf"                  # grants + officers + all 990-PF detail (fresh filing)
PASS_PF_DETAIL = "pf_detail"    # detail only: grant rows exist from an earlier load
PASS_SCHED_I = "sched_i"        # Form 990 Schedule I grants
PASS_990_DETAIL = "f990_detail"  # Form 990 core financials + Part VII officers
PASS_WEB = "web"                # filer-stated website

_LISTING_HREF = re.compile(
    r"https?://apps\.irs\.gov/pub/epostcard/990/xml/(\d{4})/([^\"'/<>\s]+)\.zip")
_HASH_PREFIX = re.compile(r"^[0-9a-f]{12}_")


def _say(msg: str = "") -> None:
    print(msg, flush=True)


def _gb(n: float | None) -> str:
    return "?" if n is None else f"{n / GB:.2f} GB"


def parse_years(text: str) -> tuple[int, ...]:
    years = tuple(int(p) for p in re.split(r"[,\s]+", text.strip()) if p)
    if not years:
        raise ValueError("no years given")
    return years


def parse_forms(text: str) -> tuple[str, ...]:
    """'990pf,990' -> ('990PF', '990'). 990-PF is always loaded."""
    keys = [p.strip().lower() for p in text.split(",") if p.strip()]
    bad = [k for k in keys if k not in FORMS]
    if bad:
        raise ValueError(f"unknown form(s) {bad}; choose from {sorted(FORMS)}")
    if "990pf" not in keys:
        raise ValueError("--forms must include 990pf (add 990 to it, e.g. 990pf,990)")
    return tuple(FORMS[k] for k in dict.fromkeys(keys))


def index_years_for(zip_year: int) -> tuple[int, ...]:
    """Index years whose filings can sit in the zips of ``zip_year``.

    Legacy zips hold returns by object-id year; the index of the NEXT year
    lists the ones posted after New Year (12,000 to 22,000 990-PFs a year).
    The 2021 index lists no 2020 object id at all, so 2020 stands alone, and
    from 2021 on the existing year-by-year behaviour is kept."""
    legacy = irs_990pf.LEGACY_BATCHES
    if zip_year in legacy and zip_year + 1 in legacy:
        return (zip_year, zip_year + 1)
    return (zip_year,)


# ---------------------------------------------------------------------------
# The plan: which zips, how big, what is done, what fits on the disk
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ZipPlan:
    year: int
    name: str            # zip stem as the IRS host spells it
    url: str
    size: int | None     # bytes
    size_from: str       # 'HEAD' | 'recorded' | 'unknown'
    listed: bool         # linked from the IRS downloads page today
    available: bool      # the host answered 200 for it (or it was not asked)


def fetch_listing(client: httpx.Client) -> dict[int, list[str]]:
    """Zip stems the IRS downloads page links today, by year folder."""
    r = client.get(LISTING_URL, follow_redirects=True)
    r.raise_for_status()
    out: dict[int, list[str]] = defaultdict(list)
    for year, stem in _LISTING_HREF.findall(r.text):
        if stem not in out[int(year)]:
            out[int(year)].append(stem)
    return dict(out)


def discover(years: tuple[int, ...], echo=_say) -> tuple[list[ZipPlan], dict]:
    """Build the zip plan from the IRS listing, the recorded legacy names and
    a HEAD per zip (one request at a time). No downloads, no database."""
    settings = get_settings()
    info: dict = {"listing_ok": False, "listed_years": {}, "unlisted_years": []}
    plans: list[ZipPlan] = []
    with httpx.Client(headers={"User-Agent": settings.http_user_agent},
                      timeout=60.0, follow_redirects=False) as client:
        try:
            listing = fetch_listing(client)
            info["listing_ok"] = True
        except httpx.HTTPError as exc:
            listing = {}
            echo(f"WARNING: could not read the IRS listing ({exc!r}); "
                 "using the recorded names only.")
        for year in years:
            recorded = irs_990pf.LEGACY_BATCHES.get(year, {})
            listed = {irs_990pf.canonical_batch(n) for n in listing.get(year, [])}
            if recorded:
                names = list(recorded)
            else:
                # 2021+: the page links only the first zip for some years, so
                # the existing probe stays the source of names.
                names = irs_990pf.probe_batches(year)
            names += sorted(n for n in listed if n not in names)
            if listed:
                info["listed_years"][year] = len(listed)
            else:
                info["unlisted_years"].append(year)
            for name in names:
                url = irs_990pf.batch_url(name, year)
                size, size_from, available = recorded.get(name), "recorded", True
                try:
                    time.sleep(_HEAD_PAUSE)
                    resp = client.head(url)
                    # The host answers 302 -> error page for a missing zip.
                    available = resp.status_code == 200
                    length = resp.headers.get("Content-Length")
                    if available and length and length.isdigit():
                        size, size_from = int(length), "HEAD"
                except httpx.HTTPError as exc:
                    echo(f"WARNING: HEAD {name}.zip failed ({exc!r}); "
                         "size taken from the recorded table.")
                if size is None:
                    size_from = "unknown"
                plans.append(ZipPlan(year, name, url, size, size_from,
                                     name in listed, available))
    return plans, info


def free_bytes() -> tuple[int, Path]:
    """Free disk where staged files land (nearest existing parent of data/raw)."""
    p = get_settings().raw_dir.resolve()
    while not p.exists():
        p = p.parent
    return shutil.disk_usage(p).free, p


def _local_state(name: str) -> tuple[Path | None, int]:
    """(staged copy if any, bytes of an unfinished download) — no hashing."""
    dest = get_settings().raw_dir / DATASET
    cached = staging.cached_candidates(dest, f"{name}.zip")
    partial = dest / f".partial_{name}.zip"
    return (cached[-1] if cached else None), (partial.stat().st_size if partial.exists() else 0)


def _still_to_download(plan: ZipPlan) -> int | None:
    cached, partial = _local_state(plan.name)
    if cached is not None:
        return 0
    return None if plan.size is None else max(plan.size - partial, 0)


def completed_notes(conn, urls: list[str]) -> dict[str, list[str]]:
    """source_url -> notes of every completed backfill ledger row for it."""
    out: dict[str, list[str]] = defaultdict(list)
    with conn.cursor() as cur:
        cur.execute(
            """
            select rf.source_url, l.notes
            from internal.ingestion_ledger l
            join internal.raw_files rf on rf.id = l.raw_file_id
            where l.dataset_name = %s and l.status = 'completed'
              and l.notes like %s and rf.source_url = any(%s::text[])
            """,
            (DATASET, LEDGER_MARK + "%", urls),
        )
        for url, notes in cur.fetchall():
            out[url].append(notes or "")
    conn.rollback()
    return dict(out)


def note_covers(note: str, forms: tuple[str, ...], include_unindexed: bool) -> bool:
    """Does a completed ledger note cover this request? A zip finished for
    990-PF only is not finished for `--forms 990pf,990`, and a zip finished
    with --indexed-only still owes its un-indexed returns."""
    m = re.search(r"forms=(\S+?);", note)
    u = re.search(r"unindexed=(yes|no);", note)
    if not m or not u:
        return False
    done = set(m.group(1).split(","))
    return set(forms) <= done and (u.group(1) == "yes" or not include_unindexed)


def _complete(notes: dict[str, list[str]], plan: ZipPlan, forms: tuple[str, ...],
              include_unindexed: bool) -> bool:
    return any(note_covers(n, forms, include_unindexed) for n in notes.get(plan.url, ()))


def print_plan(plans: list[ZipPlan], info: dict, *, forms: tuple[str, ...],
               include_unindexed: bool, min_free_gb: float, discard_zips: bool,
               notes: dict[str, list[str]] | None,
               ledger_state: str = "not checked", echo=_say) -> dict:
    free, where = free_bytes()
    floor = min_free_gb * GB
    echo(f"IRS listing: {LISTING_URL}")
    if info["listing_ok"]:
        listed = ", ".join(f"{y} ({n} zips)" for y, n in sorted(info["listed_years"].items()))
        echo(f"  listed today: {listed or 'none of the requested years'}")
        if info["unlisted_years"]:
            echo("  not listed today: "
                 + ", ".join(str(y) for y in sorted(info["unlisted_years"]))
                 + " (names from the recorded table; each one checked with a HEAD request)")
    else:
        echo("  NOT reachable; names and sizes come from the recorded table")
    echo(f"forms: {', '.join(forms)}    returns that are in no index: "
         + ("loaded too" if include_unindexed else "skipped (--indexed-only)"))
    echo(f"free disk under {where}: {_gb(free)}    --min-free-gb: {min_free_gb:g}")
    echo(f"ledger: {ledger_state}")
    echo("")
    echo(f"{'year':<5} {'zip':<25} {'size':>10} {'IRS page':<9} {'local':<9} "
         f"{'ledger':<9} {'free after':>11}  start?")
    running = free
    stopped = False   # the real run stops at the first refusal; the plan shows that
    totals = {"zips": 0, "bytes": 0, "to_download": 0, "complete": 0, "refused": 0,
              "not_reached": 0, "unavailable": 0}
    by_year: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for p in plans:
        cached, partial = _local_state(p.name)
        need = _still_to_download(p)
        done = notes is not None and _complete(notes, p, forms, include_unindexed)
        local = "staged" if cached else (f"{partial / GB:.2f}G part" if partial else "no")
        state = "n/a" if notes is None else ("complete" if done else "pending")
        totals["zips"] += 1
        totals["bytes"] += p.size or 0
        by_year[p.year][0] += 1
        by_year[p.year][1] += p.size or 0
        if not p.available:
            totals["unavailable"] += 1
            verdict, after = "NO (not on the IRS host)", None
        elif done:
            totals["complete"] += 1
            verdict, after = "skip (complete)", running
        elif stopped:
            totals["not_reached"] += 1
            verdict, after = "not reached (the run stops at the first refusal)", None
        elif need is None:
            totals["refused"] += 1
            stopped = True
            verdict, after = "NO (size unknown)", None
        else:
            after = running - need
            if after < floor:
                totals["refused"] += 1
                stopped = True
                verdict = f"NO (would leave less than {min_free_gb:g} GB)"
            else:
                verdict = "yes"
                totals["to_download"] += need
                if not discard_zips:
                    running = after   # kept zips add up; discarded ones do not
        echo(f"{p.year:<5} {p.name:<25} {_gb(p.size):>10} "
             f"{'yes' if p.listed else 'no':<9} {local:<9} {state:<9} "
             f"{_gb(after):>11}  {verdict}")
    echo("")
    for year in sorted(by_year, reverse=True):
        n, b = by_year[year]
        echo(f"{year}: {n} zips, {_gb(b)}")
    biggest = max((p.size or 0 for p in plans), default=0)
    echo(f"all years: {totals['zips']} zips, {_gb(totals['bytes'])}; "
         f"still to download: {_gb(totals['to_download'])}; "
         f"largest single zip: {_gb(biggest)}")
    if discard_zips:
        echo("--discard-zips: each zip is deleted after its ledger row is written, so the "
             f"peak extra disk is one zip ({_gb(biggest)}) plus the index CSVs (about 0.06 GB each).")
    else:
        echo("Without --discard-zips every zip stays on disk "
             f"({_gb(totals['bytes'])} in all). On a small disk add --discard-zips.")
    if totals["refused"]:
        echo(f"As things stand the run would stop at the first refused zip; "
             f"{totals['not_reached']} more zip(s) would not be reached.")
    return totals


# ---------------------------------------------------------------------------
# What is in a zip, and what each filing still needs
# ---------------------------------------------------------------------------
@dataclass
class IndexPool:
    """The index rows a zip is checked against."""
    years: tuple[int, ...] = ()
    targets: dict[str, tuple[str, PfFiling]] = field(default_factory=dict)  # oid -> (form, row)
    other: set[str] = field(default_factory=set)   # indexed under a form we do not load


def build_pool(index_years: tuple[int, ...], forms: tuple[str, ...]) -> IndexPool:
    pool = IndexPool(years=tuple(index_years))
    for year in index_years:
        for form, filing in irs_990pf.iter_index(year):
            if form in forms:
                pool.targets[filing.object_id] = (form, filing)
            else:
                pool.other.add(filing.object_id)
    return pool


@dataclass(frozen=True)
class FilingState:
    return_type: str
    grants_done: bool
    details_done: bool
    website_done: bool


def db_state(conn, object_ids: list[str]) -> dict[str, FilingState]:
    """Markers for the filings of one zip (read only)."""
    if not object_ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """
            select object_id, return_type, grants_processed_at is not null,
                   details_parsed_at is not null, website_parsed_at is not null
            from internal.filings
            where object_id = any(%s::text[])
            """,
            (object_ids,),
        )
        out = {r[0]: FilingState(r[1], r[2], r[3], r[4]) for r in cur.fetchall()}
    conn.rollback()
    return out


def passes_for(form: str, st: FilingState | None, ein: str | None,
               daf_eins: set[str]) -> set[str]:
    """The passes a filing still needs, from its markers. Empty = fully done."""
    out: set[str] = set()
    grants_done = bool(st and st.grants_done)
    details_done = bool(st and st.details_done)
    if form == "990PF":
        if not grants_done:
            out.add(PASS_PF)             # _load_batch writes the detail tables too
        elif not details_done:
            out.add(PASS_PF_DETAIL)
    elif form == "990":
        # Mega-DAF sponsors are left to their own pass, as in `ingest 990`.
        if not grants_done and (ein is None or ein not in daf_eins):
            out.add(PASS_SCHED_I)
        if not details_done:
            out.add(PASS_990_DETAIL)
    if not (st and st.website_done):
        out.add(PASS_WEB)
    return out


def member_ids(path: Path) -> list[str]:
    """Object ids of the `<OBJECT_ID>_public.xml` members, flat or nested."""
    with zipfile.ZipFile(path) as zf:
        out = []
        for name in zf.namelist():
            base = name.rsplit("/", 1)[-1]
            if base.endswith("_public.xml"):
                out.append(base[: -len("_public.xml")])
    return out


def zip_facts(path: Path) -> dict:
    """Layout facts worth printing before trusting an archive."""
    with zipfile.ZipFile(path) as zf:
        infos = zf.infolist()
    methods = Counter(i.compress_type for i in infos)
    names = {0: "stored", 8: "deflate", 9: "deflate64", 12: "bzip2", 14: "lzma"}
    return {
        "members": len(infos),
        "compression": {names.get(k, str(k)): v for k, v in methods.items()},
        "nested": sum(1 for i in infos if "/" in i.filename.rstrip("/")),
        "not_public_xml": sum(1 for i in infos if not i.is_dir()
                              and not i.filename.endswith("_public.xml")),
        "uncompressed_bytes": sum(i.file_size for i in infos),
    }


@dataclass
class Work:
    """One return read from a zip, parsed for the passes it still needs."""
    filing: PfFiling
    form: str
    passes: set[str]
    unindexed: bool               # in no index CSV: filing was read from the header
    needs_spine: bool             # ...and has no row in internal.filings yet
    pf: Parsed | None = None
    sched_i: irs_990_sched_i.ParsedSchedI | None = None
    f990: Parsed | None = None
    website_raw: str | None = None
    website: str | None = None
    error: str | None = None
    header: tuple[str, PfFiling] | None = None   # parse-only: header view of an indexed return


def iter_work(path: Path, pool: IndexPool, state: dict[str, FilingState],
              forms: tuple[str, ...], include_unindexed: bool, daf_eins: set[str],
              counts: dict, *, check_headers: bool = False):
    """Yield a Work for every member of ``path`` that still needs something.

    Membership-driven, like the ingest loaders: the zip's own member list is
    matched against the index pool, so a wrong or missing batch label cannot
    hide a return. One pass over the archive serves every form and every pass.
    """
    plan: dict[str, tuple[str, PfFiling, set[str]]] = {}
    todo: list[PfFiling] = []
    for oid in member_ids(path):
        counts["members"] += 1
        hit = pool.targets.get(oid)
        st = state.get(oid)
        if hit is not None:
            form, filing = hit
            passes = passes_for(form, st, filing.ein, daf_eins)
            if not passes:
                counts["already_done"] += 1
                continue
            plan[oid] = (form, filing, passes)
            todo.append(filing)
        elif oid in pool.other:
            counts["indexed_other_forms"] += 1
        elif st is not None and (st.return_type not in forms
                                 or not passes_for(st.return_type, st, None, daf_eins)):
            # In no index, but an earlier run already read it from its header.
            counts["already_done"] += 1
        elif include_unindexed or st is not None:
            counts["unindexed_opened"] += 1
            todo.append(PfFiling(oid, "", "", "", ""))   # filled in from the header
        else:
            counts["unindexed_skipped"] += 1

    for f, data in irs_990pf._iter_wanted_members(path, todo, counts):
        oid = f.object_id
        header = None
        try:
            if oid in plan:
                form, filing, passes = plan[oid]
                unindexed = False
                if check_headers:
                    header = irs_990pf.filing_from_header(oid, data)
            else:
                hf = irs_990pf.filing_from_header(oid, data)
                if hf is None:
                    counts["unindexed_unreadable"] += 1
                    continue
                form, filing = hf
                if form not in forms:
                    counts["unindexed_other_forms"] += 1
                    continue
                passes = passes_for(form, state.get(oid), filing.ein, daf_eins)
                if not passes:
                    counts["already_done"] += 1
                    continue
                unindexed = True
        except etree.XMLSyntaxError:
            counts["xml_errors"] += 1
            continue
        w = Work(filing, form, passes, unindexed,
                 needs_spine=unindexed and oid not in state, header=header)
        try:
            if PASS_PF in passes or PASS_PF_DETAIL in passes:
                w.pf = irs_990pf.parse_filing(data, filing)
            if PASS_SCHED_I in passes:
                w.sched_i = irs_990_sched_i.parse_filing_990(data, filing)
            if PASS_990_DETAIL in passes:
                w.f990 = irs_990_detail.parse_filing_990_detail(data, filing)
            if PASS_WEB in passes:
                w.website_raw = irs_990_websites.extract_raw(data)
                w.website = irs_990_websites.normalize_website(w.website_raw)
        except etree.XMLSyntaxError as exc:
            w.error = f"XMLSyntaxError: {exc}"
            counts["xml_errors"] += 1
        yield w


# ---------------------------------------------------------------------------
# Loading one zip
# ---------------------------------------------------------------------------
@dataclass
class _Chunk:
    spine: list[tuple] = field(default_factory=list)
    pf_fresh: list[tuple[PfFiling, Parsed]] = field(default_factory=list)
    pf_detail: list[tuple[PfFiling, Parsed]] = field(default_factory=list)
    pf_errors: list[tuple[PfFiling, str]] = field(default_factory=list)
    sched_i: list[tuple[PfFiling, irs_990_sched_i.ParsedSchedI]] = field(default_factory=list)
    f990: list[tuple[PfFiling, Parsed]] = field(default_factory=list)
    f990_errors: list[tuple[PfFiling, str]] = field(default_factory=list)
    web: list[tuple[str, str | None]] = field(default_factory=list)
    filings: int = 0

    def add(self, w: Work) -> None:
        self.filings += 1
        f = w.filing
        if w.needs_spine:
            # Same tuple shape as irs_filings.load_spine_rows; there is no DLN,
            # posting date or batch label outside the index.
            self.spine.append((f.object_id, f.ein, w.form, f.tax_period,
                               f.taxpayer_name or None, None, None, None))
        if w.error:
            # Record the failure on the filing so the detail pass does not
            # retry it forever; the grants marker stays unset on purpose.
            if PASS_PF in w.passes or PASS_PF_DETAIL in w.passes:
                self.pf_errors.append((f, w.error))
            if PASS_990_DETAIL in w.passes:
                self.f990_errors.append((f, w.error))
        else:
            if PASS_PF in w.passes:
                self.pf_fresh.append((f, w.pf))
            elif PASS_PF_DETAIL in w.passes:
                self.pf_detail.append((f, w.pf))
            if PASS_SCHED_I in w.passes:
                self.sched_i.append((f, w.sched_i))
            if PASS_990_DETAIL in w.passes:
                self.f990.append((f, w.f990))
        if PASS_WEB in w.passes:
            self.web.append((f.object_id, w.website))


def _flush(conn, raw_file_id: int, c: _Chunk, agg: dict) -> None:
    """Write one chunk through the existing loaders, one transaction per pass."""
    def add(counts: dict, prefix: str = "") -> None:
        for k, v in counts.items():
            if v:
                agg[prefix + k] += v

    if c.spine:
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '30min'")
            inserted, _updated = irs_filings.upsert_spine_rows(cur, c.spine, raw_file_id)
        conn.commit()
        agg["spine_rows_from_headers"] += inserted
    if c.pf_fresh:
        add(irs_990pf._load_batch(conn, raw_file_id,
                                  [f for f, _ in c.pf_fresh], [p for _, p in c.pf_fresh]))
        conn.commit()
        agg["pf_filings"] += len(c.pf_fresh)
    if c.pf_detail or c.pf_errors:
        add(irs_990pf.load_detail_chunk(
            conn, raw_file_id, [f for f, _ in c.pf_detail], [p for _, p in c.pf_detail],
            errors=c.pf_errors))
        agg["pf_detail_filings"] += len(c.pf_detail)
    if c.sched_i:
        r = irs_990_sched_i._load_batch(conn, raw_file_id,
                                        [f for f, _ in c.sched_i], [p for _, p in c.sched_i])
        conn.commit()
        agg["orgs_created"] += r["orgs_created"]
        agg["sched_i_grants"] += r["grants"]
        agg["sched_i_filings"] += len(c.sched_i)
    if c.f990 or c.f990_errors:
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '30min'")
            add(irs_990pf._load_details(
                cur, raw_file_id, [f for f, _ in c.f990], [p for _, p in c.f990],
                errors=c.f990_errors, update_grants=False,
                fin_columns=irs_990_detail.F990_COLUMNS), prefix="f990_")
        conn.commit()
        agg["f990_filings"] += len(c.f990)
    if c.web:
        agg["websites_stamped"] += irs_990_websites._write_batch(
            conn, [o for o, _ in c.web], [s for _, s in c.web])
        agg["websites_usable"] += sum(1 for _, s in c.web if s)


def load_zip(conn, path: Path, raw_file_id: int, pool: IndexPool, forms: tuple[str, ...],
             include_unindexed: bool, daf_eins: set[str]) -> dict:
    """Everything wanted from one staged zip, in one pass, chunk-committed."""
    agg: dict[str, int] = defaultdict(int)
    state = db_state(conn, member_ids(path))
    chunk = _Chunk()
    for w in iter_work(path, pool, state, forms, include_unindexed, daf_eins, agg):
        agg["filings_read"] += 1
        if w.unindexed:
            agg["unindexed_loaded"] += 1
        chunk.add(w)
        if chunk.filings >= CHUNK:
            _flush(conn, raw_file_id, chunk, agg)
            chunk = _Chunk()
    if chunk.filings:
        _flush(conn, raw_file_id, chunk, agg)
    return dict(agg)


def _ledger_note(plan: ZipPlan, forms: tuple[str, ...], include_unindexed: bool,
                 agg: dict) -> str:
    return (f"{LEDGER_MARK} zip={plan.name}; forms={','.join(forms)}; "
            f"unindexed={'yes' if include_unindexed else 'no'}; "
            + json.dumps(dict(sorted(agg.items()))))


def _set_local_copy(conn, raw_file_id: int, note: dict) -> None:
    """Merge a `local_copy` note into raw_files.meta. The row itself — sha256,
    source_url, byte_size, licence — is never touched."""
    with conn.cursor() as cur:
        cur.execute(
            "update internal.raw_files "
            "set meta = coalesce(meta, '{}'::jsonb) || %s::jsonb where id = %s",
            (json.dumps({"local_copy": note}), raw_file_id),
        )
    conn.commit()


def _note_refetched(conn, raw_file_id: int) -> None:
    """A zip that was discarded earlier is on disk again: say so."""
    with conn.cursor() as cur:
        cur.execute(
            "update internal.raw_files set meta = meta || %s::jsonb "
            "where id = %s and meta->'local_copy'->>'state' = 'discarded'",
            (json.dumps({"local_copy": {
                "state": "present",
                "refetched_at": datetime.now(timezone.utc).isoformat()}}), raw_file_id),
        )
    conn.commit()


def discard_zip(conn, raw_file_id: int, staged: staging.StagedFile) -> None:
    """Delete the local zip AFTER noting it in raw_files.meta. The registry row
    keeps the sha256 and the source URL, so the same bytes can be fetched
    again and checked; the sidecar next to the deleted file says so too."""
    now = datetime.now(timezone.utc).isoformat()
    _set_local_copy(conn, raw_file_id, {
        "state": "discarded",
        "discarded_at": now,
        "reason": "funderdb backfill --discard-zips (small disk)",
        "refetch_url": staged.source_url,
        "sha256": staged.sha256,
        "byte_size": staged.byte_size,
    })
    sidecar = staging._sidecar_path(staged.path)
    meta = staging._read_sidecar(staged.path)
    staged.path.unlink(missing_ok=True)
    if meta:
        meta["local_copy"] = {"state": "discarded", "discarded_at": now}
        sidecar.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def ensure_spine(conn, year: int, echo=_say) -> None:
    """Load the year's index into the spine unless every row is already there."""
    _staged, rows = irs_filings.load_spine_rows(year)
    with conn.cursor() as cur:
        cur.execute("select count(*) from internal.filings where object_id = any(%s::text[])",
                    ([r[0] for r in rows],))
        have = cur.fetchone()[0]
    conn.rollback()
    if have == len(rows):
        echo(f"spine {year}: all {len(rows):,} index rows already present")
        return
    echo(f"spine {year}: {have:,} of {len(rows):,} index rows present; loading the index")
    irs_filings.load_spine_year(conn, year)


def sweep_year(conn, year: int, plans: list[ZipPlan], echo=_say) -> dict:
    """Amended-return sweep for the groups this year's index and zips touched.
    No materialized-view refresh: that is a follow-up, run once at the end."""
    urls = [irs_990pf.INDEX_URL.format(year=year)] + [p.url for p in plans if p.year == year]
    with conn.cursor() as cur:
        cur.execute("select id from internal.raw_files "
                    "where dataset_name = %s and source_url = any(%s::text[])",
                    (DATASET, urls))
        ids = [int(r[0]) for r in cur.fetchall()]
    conn.rollback()
    counts = irs_filings.reconcile(conn, scope_raw_file_ids=ids, refresh_stats=False)
    echo(f"{year}: supersession sweep over {len(ids)} raw files: {counts}")
    return counts


# ---------------------------------------------------------------------------
# Follow-ups
# ---------------------------------------------------------------------------
FOLLOW_UPS: list[tuple[str, str]] = [
    ("uv run funderdb refresh-views",
     "rebuild the materialized views the app reads (totals, latest financials, posture)"),
    ("uv run funderdb resolve recipients",
     "link the new grant rows to recipient organizations (EIN, then name and state)"),
    ("uv run funderdb contacts sync-part-xv",
     "tier the Part XV application contacts of the new filings"),
    ("uv run funderdb embed sync",
     "rebuild the search documents and embed the changed ones (needs VOYAGE_API_KEY)"),
]


def refresh_views() -> None:
    """`funderdb refresh-views`: refresh every materialized view that
    internal.refresh_dashboard_stats() names, in the order it names them.

    The SQL function refreshes all of them in ONE transaction, so every view
    stays locked against readers until the last one is done. This does the
    same work one view at a time, so a page that reads a view waits for that
    view only:

    * Each view is its own transaction with a short lock_timeout. A plain
      refresh needs a lock that no reader may hold; while it waits for a long
      reader, every NEW reader queues behind it. With the timeout the refresh
      gives up after a few seconds, the view keeps its old rows, and it is
      tried again after the other views (three rounds in all).
    * The two views the app reads most (the application answer and the
      latest financials) are refreshed CONCURRENTLY: readers are never
      blocked. That needs a unique index and a view that holds data already;
      without either, the view gets a plain refresh.
    * The application-history view is refreshed in the same transaction and
      from the same snapshot as the application answer, so the two always
      name the same latest return (migration 0029).
    * The time each view took is printed.

    Raises RuntimeError naming the views that could not be refreshed.
    """
    import psycopg
    from psycopg import sql

    from .db import connect

    lock_timeout = "3s"
    rounds, pause_s = 3, 15
    without_blocking_readers = {"mv_org_application_posture", "mv_org_latest_financials"}
    # view -> the view it must be refreshed together with (when that one is
    # named straight before it)
    same_snapshot_as = {"mv_org_posture_history": "mv_org_application_posture"}

    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("select pg_get_functiondef("
                        "'internal.refresh_dashboard_stats()'::regprocedure)")
            names = re.findall(
                r"refresh\s+materialized\s+view\s+(?:concurrently\s+)?internal\.(\w+)",
                cur.fetchone()[0], flags=re.IGNORECASE)
            cur.execute(
                """select c.relname, c.relispopulated,
                          exists (select 1 from pg_index i
                                  where i.indrelid = c.oid and i.indisunique and i.indisvalid
                                    and i.indpred is null and i.indexprs is null)
                   from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'internal' and c.relkind = 'm'
                     and c.relname = any(%s)""", (names,))
            facts = {name: (populated, unique) for name, populated, unique in cur.fetchall()}
        conn.rollback()
        if not names:
            raise RuntimeError("internal.refresh_dashboard_stats() names no materialized "
                               "view. Nothing was refreshed.")

        groups: list[list[str]] = []
        for name in names:
            if groups and same_snapshot_as.get(name) == groups[-1][-1]:
                groups[-1].append(name)
            else:
                groups.append([name])

        t_all = time.monotonic()
        todo = groups
        for round_no in range(1, rounds + 1):
            waiting: list[list[str]] = []
            for group in todo:
                took: list[tuple[str, bool, float]] = []
                try:
                    with conn.cursor() as cur:
                        if len(group) > 1:
                            cur.execute("set transaction isolation level repeatable read")
                        cur.execute(f"set local lock_timeout = '{lock_timeout}'")
                        cur.execute("set local statement_timeout = '120min'")
                        for name in group:
                            populated, unique = facts.get(name, (False, False))
                            gentle = name in without_blocking_readers and populated and unique
                            t0 = time.monotonic()
                            cur.execute(sql.SQL("refresh materialized view {}{}").format(
                                sql.SQL("concurrently " if gentle else ""),
                                sql.Identifier("internal", name)))
                            took.append((name, gentle, time.monotonic() - t0))
                    conn.commit()
                except psycopg.errors.LockNotAvailable:
                    conn.rollback()
                    waiting.append(group)
                    _say(f"  {' + '.join(group)}: NOT refreshed in round {round_no}. Another "
                         f"session held a lock for more than {lock_timeout}. The old rows "
                         "stay in place.")
                    continue
                for name, gentle, seconds in took:
                    _say(f"  {name}: refreshed in {seconds:.1f}s"
                         + (" (readers were not blocked)" if gentle else ""))
            todo = waiting
            if not todo:
                break
            if round_no < rounds:
                _say(f"  {sum(len(g) for g in todo)} view(s) to try again in {pause_s}s")
                time.sleep(pause_s)
        _say(f"  all views tried, {time.monotonic() - t_all:.1f}s in total")
        if todo:
            left = ", ".join(name for group in todo for name in group)
            raise RuntimeError(
                f"These materialized views were NOT refreshed after {rounds} tries, because "
                f"another session kept a lock on them: {left}. They still hold their old "
                "rows. The other views are refreshed. Run `uv run funderdb refresh-views` "
                "again.")
    finally:
        try:
            conn.close()
        except Exception:
            pass


def print_follow_ups(echo=_say) -> None:
    echo("")
    echo("Follow-up commands. Run them in this order when the backfill is done")
    echo("(or run the backfill with --finish to do all four):")
    for i, (cmd, why) in enumerate(FOLLOW_UPS, 1):
        echo(f"  {i}. {cmd:<40} # {why}")
    echo("After step 2 has linked recipients, run step 1 once more if you need the")
    echo("recipient-side totals to include the new links.")


def run_follow_ups(echo=_say) -> None:
    from . import embed as embed_mod
    from .resolve import recipients
    from .sources import part_xv_contacts

    steps = [
        (FOLLOW_UPS[0][0], refresh_views),
        (FOLLOW_UPS[1][0], recipients.run),
        (FOLLOW_UPS[2][0], part_xv_contacts.sync),
        (FOLLOW_UPS[3][0], embed_mod.sync),
    ]
    for i, (cmd, fn) in enumerate(steps, 1):
        if fn is embed_mod.sync and not get_settings().voyage_api_key:
            echo(f"[{i}/4] {cmd}: SKIPPED, VOYAGE_API_KEY is not set. Run it later.")
            continue
        echo(f"[{i}/4] {cmd}")
        t0 = time.monotonic()
        result = fn()
        if isinstance(result, dict):
            echo("      " + ", ".join(f"{k}={v}" for k, v in result.items()
                                      if isinstance(v, (int, float, str)))[:400])
        echo(f"[{i}/4] done in {time.monotonic() - t0:.0f}s")


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------
def run(years: tuple[int, ...] = DEFAULT_YEARS, forms: tuple[str, ...] = ("990PF",), *,
        min_free_gb: float = 6.0, limit_zips: int | None = None,
        discard_zips: bool = False, dry_run: bool = False, resume: bool = True,
        finish: bool = False, include_unindexed: bool = True, prefetch: int = 0,
        echo=_say) -> dict:
    settings = get_settings()
    plans, info = discover(years, echo=echo)

    if dry_run:
        echo("Backfill plan (dry run: nothing is downloaded, nothing is written)")
        notes = None
        ledger_state = "not checked (DATABASE_URL is not set)"
        if settings.database_url:
            import psycopg

            from .db import connect

            try:
                with connect() as conn:
                    conn.read_only = True
                    notes = completed_notes(conn, [p.url for p in plans])
                ledger_state = "checked (read only)"
            except psycopg.Error as exc:
                # A read-only app role may not read the ledger. The plan is
                # still useful; it just cannot say what is already complete.
                ledger_state = ("not checked (this database role cannot read the ledger: "
                                f"{str(exc).strip().splitlines()[0]})")
        totals = print_plan(plans, info, forms=forms, include_unindexed=include_unindexed,
                            min_free_gb=min_free_gb, discard_zips=discard_zips,
                            notes=notes, ledger_state=ledger_state, echo=echo)
        print_follow_ups(echo)
        return {"dry_run": True, **totals}

    from .db import connect

    summary: dict = {"zips_done": 0, "zips_skipped": 0, "zips_unavailable": 0,
                     "stopped": None, "rows": defaultdict(int)}
    floor = min_free_gb * GB
    with connect() as conn:
        notes = completed_notes(conn, [p.url for p in plans]) if resume else {}
        daf_eins = irs_990_sched_i.mega_daf_eins(conn) if "990" in forms else set()
        conn.rollback()
        for year in years:
            if summary["stopped"]:
                break
            year_plans = [p for p in plans if p.year == year]
            pending = [p for p in year_plans
                       if p.available and not _complete(notes, p, forms, include_unindexed)]
            unavailable = sum(1 for p in year_plans if not p.available)
            summary["zips_unavailable"] += unavailable
            summary["zips_skipped"] += len(year_plans) - len(pending) - unavailable
            echo(f"\n== {year}: {len(year_plans)} zips, {len(pending)} to do, "
                 f"index years {index_years_for(year)}")
            for missing in (p for p in year_plans if not p.available):
                echo(f"  {missing.name}: not on the IRS host; skipped")
            pool = None
            if pending:
                for iy in index_years_for(year):
                    ensure_spine(conn, iy, echo)
                pool = build_pool(index_years_for(year), forms)
            # Download-ahead: one worker thread stages upcoming zips (one
            # connection to the IRS host at a time) while this thread loads the
            # current one. prefetch=0 keeps the plain download-then-load order.
            executor = ThreadPoolExecutor(max_workers=1) if prefetch > 0 else None
            futures: dict[str, Future] = {}

            def ensure_prefetch(i: int, year=year, pending=pending,
                                executor=executor, futures=futures) -> None:
                if executor is None:
                    return
                last = i + prefetch
                if limit_zips is not None:
                    last = min(last, i + (limit_zips - summary["zips_done"]) - 1)
                for nxt in pending[i:last + 1]:
                    if nxt.name in futures:
                        continue
                    need_nxt = _still_to_download(nxt)
                    queued = sum((_still_to_download(q) or 0) for q in pending
                                 if q.name in futures and not futures[q.name].done())
                    free_now, _ = free_bytes()
                    if need_nxt is None or free_now - queued - need_nxt < floor:
                        break
                    futures[nxt.name] = executor.submit(irs_990pf.stage_batch, year, nxt.name)

            for i, plan in enumerate(pending):
                if limit_zips is not None and summary["zips_done"] >= limit_zips:
                    summary["stopped"] = f"--limit-zips {limit_zips} reached"
                    break
                need = _still_to_download(plan)
                free, where = free_bytes()
                if need is None or free - need < floor:
                    summary["stopped"] = "disk"
                    echo(f"  {plan.name}: REFUSED. Free disk under {where} is {_gb(free)}; "
                         f"this download needs {_gb(need)} and --min-free-gb is "
                         f"{min_free_gb:g}. Free some space (or use --discard-zips) and "
                         "run the same command again.")
                    break
                t0 = time.monotonic()
                ensure_prefetch(i)
                fut = futures.get(plan.name)
                staged = fut.result() if fut is not None else irs_990pf.stage_batch(year, plan.name)
                raw_file_id = staging.register_raw_file(
                    conn, staged, license_code="us_public_domain",
                    content_type="application/zip",
                )
                conn.commit()
                if not staged.from_cache:
                    _note_refetched(conn, raw_file_id)
                run_id = ledger.start_run(conn, raw_file_id, DATASET)
                try:
                    agg = load_zip(conn, staged.path, raw_file_id, pool, forms,
                                   include_unindexed, daf_eins)
                    ledger.complete_run(
                        conn, run_id,
                        inserted=(agg.get("grants", 0) + agg.get("sched_i_grants", 0)
                                  + agg.get("financials", 0) + agg.get("f990_financials", 0)),
                        updated=agg.get("websites_stamped", 0),
                        skipped=agg.get("already_done", 0),
                        notes=_ledger_note(plan, forms, include_unindexed, agg),
                    )
                except Exception as exc:
                    try:
                        conn.rollback()
                        ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                    except Exception:
                        pass
                    raise
                summary["zips_done"] += 1
                for k, v in agg.items():
                    summary["rows"][k] += v
                echo(f"  {plan.name}: {'cached' if staged.from_cache else 'downloaded'} "
                     f"{_gb(staged.byte_size)}, sha256 {staged.sha256[:12]}, "
                     f"{time.monotonic() - t0:.0f}s  {dict(sorted(agg.items()))}")
                if discard_zips:
                    discard_zip(conn, raw_file_id, staged)
                    echo(f"  {plan.name}: local copy discarded (raw_files row {raw_file_id} "
                         "keeps sha256 and source URL)")
            # The sweep runs whenever the year was looked at, complete or not:
            # an amended return must never keep event rows, even between runs.
            if executor is not None:
                # A zip already downloading finishes (it is reused by the next
                # run); queued ones that have not started are dropped.
                executor.shutdown(wait=True, cancel_futures=True)
            sweep_year(conn, year, plans, echo)

    summary["rows"] = dict(summary["rows"])
    echo(f"\nzips processed: {summary['zips_done']}   "
         f"already complete (skipped): {summary['zips_skipped']}"
         + (f"   not on the IRS host: {summary['zips_unavailable']}"
            if summary["zips_unavailable"] else "")
         + (f"   stopped: {summary['stopped']}" if summary["stopped"] else ""))
    if finish and not summary["stopped"]:
        run_follow_ups(echo)
    else:
        if finish:
            echo("--finish was NOT run because the backfill stopped early.")
        print_follow_ups(echo)
    return summary


# ---------------------------------------------------------------------------
# Parse only: one local zip, no database, no zip download
# ---------------------------------------------------------------------------
def _zip_year(path: Path) -> int | None:
    stem = _HASH_PREFIX.sub("", path.name)
    year = irs_990pf.batch_year(stem, 0)
    return year or None


def parse_only(zip_path: Path, forms: tuple[str, ...] = ("990PF",), *,
               year: int | None = None, limit: int | None = None,
               include_unindexed: bool = True, echo=_say) -> dict:
    """Parse one already-downloaded zip exactly as the backfill would, and
    print what it found: counts, the per-returnVersion coverage histogram
    (the schema-drift instrument behind `ingest 990pf-detail --dry-run`), and
    how well return headers agree with the index. Touches no database; the
    only downloads are index CSVs that are not staged yet."""
    year = year or _zip_year(zip_path)
    if year is None:
        raise ValueError("cannot tell the zip's year from its name; pass --years YYYY")
    t0 = time.monotonic()
    facts = zip_facts(zip_path)
    echo(f"zip: {zip_path.name}  {_gb(zip_path.stat().st_size)}  "
         f"members={facts['members']:,}  compression={facts['compression']}  "
         f"nested={facts['nested']}  not-*_public.xml={facts['not_public_xml']}  "
         f"uncompressed={_gb(facts['uncompressed_bytes'])}")
    pool = build_pool(index_years_for(year), forms)
    echo(f"index years checked: {pool.years}  forms: {', '.join(forms)}  "
         f"index rows of those forms: {len(pool.targets):,}")

    counts: dict[str, int] = defaultdict(int)
    t: dict[str, int] = defaultdict(int)
    pf_ver: dict = {}
    f990_ver: dict = {}
    per_ver: dict[str, Counter] = defaultdict(Counter)
    agree = Counter()
    for w in iter_work(zip_path, pool, {}, forms, include_unindexed, set(), counts,
                       check_headers=True):
        t["filings"] += 1
        t[f"filings_{w.form}"] += 1
        t["unindexed_filings"] += 1 if w.unindexed else 0
        if w.header is not None:
            hform, hf = w.header
            agree["checked"] += 1
            agree["form"] += hform == w.form
            agree["ein"] += hf.ein == w.filing.ein
            agree["tax_period"] += hf.tax_period == w.filing.tax_period
        if w.error:
            continue
        if w.pf is not None and w.pf.header:
            p = w.pf
            irs_990pf.coverage_add(pf_ver, p)
            v = per_ver[p.header.get("return_version") or "?"]
            v["filings"] += 1
            v["with_grants"] += 1 if p.grants else 0
            v["grants"] += len(p.grants)
            v["officers"] += len(p.filing_officers)
            v["app_info"] += 1 if p.app_info else 0
            reported = p.fin.get("total_grants_paid") or 0
            v["grants_paid_reported"] += 1 if reported > 0 else 0
            v["reported_but_no_rows"] += 1 if reported > 0 and not p.grants else 0
            t["grants"] += len(p.grants)
            t["grant_commitments"] += len(p.future_grants)
            t["officers"] += len(p.filing_officers)
            t["schedule_b_rows"] += len(p.contributors)
            t["part_xv_filings"] += 1 if p.app_info else 0
        if w.f990 is not None and w.f990.header:
            irs_990pf.coverage_add(f990_ver, w.f990, irs_990_detail.F990_COLUMNS)
            t["f990_officers"] += len(w.f990.filing_officers)
        if w.sched_i is not None:
            t["sched_i_grants"] += len(w.sched_i.grants)
            t["sched_i_filings"] += 1 if w.sched_i.grants else 0
        if PASS_WEB in w.passes:
            t["websites_stated"] += 1 if w.website_raw else 0
            t["websites_usable"] += 1 if w.website else 0
        if limit and t["filings"] >= limit:
            break

    secs = time.monotonic() - t0
    echo(f"members: {dict(sorted(counts.items()))}")
    echo(f"parsed in {secs:.0f}s ({t['filings'] / max(secs, 0.001):.0f} returns/s): "
         f"filings={t['filings']:,} (990-PF {t['filings_990PF']:,}, Form 990 "
         f"{t['filings_990']:,}; in no index: {t['unindexed_filings']:,})")
    echo(f"990-PF rows: grants={t['grants']:,}  grant_commitments={t['grant_commitments']:,}  "
         f"officers={t['officers']:,}  schedule_b={t['schedule_b_rows']:,}  "
         f"part_xv_filings={t['part_xv_filings']:,}")
    echo(f"websites (all forms read): stated={t['websites_stated']:,}  "
         f"usable={t['websites_usable']:,}")
    if "990" in forms:
        echo(f"Form 990 rows: schedule_i_grants={t['sched_i_grants']:,} "
             f"(from {t['sched_i_filings']:,} filings)  part_vii_officers={t['f990_officers']:,}")
    if agree["checked"]:
        n = agree["checked"]
        echo(f"header vs index on {n:,} indexed returns: form {agree['form']:,} agree, "
             f"EIN {agree['ein']:,} agree, tax period {agree['tax_period']:,} agree")
    echo("\n990-PF coverage by returnVersion "
         f"({len(irs_990pf.FIN_COLUMNS)} financial columns):")
    irs_990pf.print_coverage(pf_ver, headline=(
        "total_revenue", "total_assets_eoy", "qualifying_distributions", "total_grants_paid"))
    echo("990-PF rows by returnVersion:")
    for ver in sorted(per_ver):
        v = per_ver[ver]
        echo(f"  {ver}: filings={v['filings']:,}  with_grants={v['with_grants']:,}  "
             f"grants={v['grants']:,}  officers={v['officers']:,}  "
             f"part_xv={v['app_info']:,}  reported grants paid but no grant rows="
             f"{v['reported_but_no_rows']:,} of {v['grants_paid_reported']:,}")
    if f990_ver:
        echo(f"\nForm 990 coverage by returnVersion ({len(irs_990_detail.F990_COLUMNS)} columns):")
        irs_990pf.print_coverage(f990_ver, irs_990_detail.F990_COLUMNS, headline=(
            "total_revenue", "total_assets_eoy", "expenses_program_services"))
    return {"seconds": secs, **dict(t), **{f"members_{k}": v for k, v in counts.items()}}

"""Benchmark suite v2 runner — `funderdb eval sql|semantic|er|all`.

One line per check: `id · series · PASS/FAIL/REPORT/SKIP · summary`.
Exit code is nonzero iff any check FAILs; REPORT/SKIP never gate.

B-series SQL executes VERBATIM from benchmarks/queries.sql (split on the
`-- B<n>.` headers) — queries.sql remains the single human-readable record
and is append-never-rewrite; this runner prints a paste-ready dated results
block, and appending it stays a reviewed git action.
"""

from __future__ import annotations

import re
import sys
from datetime import date
from pathlib import Path

from .db import connect

_REPO = Path(__file__).resolve().parents[2]
_QUERIES = _REPO / "benchmarks" / "queries.sql"


def _expectations():
    """benchmarks/ is repo data, not an installed package — load by path."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "ofdb_expectations", _REPO / "benchmarks" / "expectations.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_b_blocks() -> dict[int, str]:
    """{block_number: single SQL statement} from queries.sql, verbatim."""
    text = _QUERIES.read_text()
    headers = list(re.finditer(r"^-- B(\d+)\. ", text, re.M))
    blocks: dict[int, str] = {}
    for i, m in enumerate(headers):
        end = headers[i + 1].start() if i + 1 < len(headers) else \
            text.find("-- ======", m.start())
        body = text[m.start():end if end != -1 else len(text)]
        sql = "\n".join(l for l in body.splitlines() if not l.lstrip().startswith("--"))
        sql = sql.strip().rstrip(";").strip()
        if sql:
            blocks[int(m.group(1))] = sql
    return blocks


class _Result:
    def __init__(self):
        self.lines: list[tuple[str, str, str, str]] = []
        self.failed = 0

    def add(self, check_id: str, series: str, ok: bool | None, summary: str):
        status = "PASS" if ok else ("FAIL" if ok is False else "REPORT")
        if ok is False:
            self.failed += 1
        self.lines.append((check_id, series, status, summary))
        print(f"{check_id:>5} · {series:>2} · {status:<6} · {summary}", flush=True)

    def skip(self, check_id: str, series: str, summary: str):
        self.lines.append((check_id, series, "SKIP", summary))
        print(f"{check_id:>5} · {series:>2} · {'SKIP':<6} · {summary}", flush=True)


def _run_sql(res: _Result, conn) -> None:
    exp = _expectations()
    B_CHECKS, SQL_INLINE = exp.B_CHECKS, exp.SQL_INLINE

    blocks = _load_b_blocks()
    with conn.cursor() as cur:
        cur.execute("set statement_timeout = '120s'")
        for n in sorted(B_CHECKS):
            if n not in blocks:
                res.add(f"B{n}", "B", False, "block missing from queries.sql")
                continue
            try:
                cur.execute(blocks[n])
                ok, summary = B_CHECKS[n](cur.fetchall())
            except Exception as exc:
                conn.rollback()
                ok, summary = False, f"{type(exc).__name__}: {exc}"
            res.add(f"B{n}", "B", ok, summary)
        for spec in SQL_INLINE:
            try:
                cur.execute(spec["sql"])
                ok, summary = spec["assert"](cur.fetchall())
            except Exception as exc:
                conn.rollback()
                ok, summary = False, f"{type(exc).__name__}: {exc}"
            res.add(spec["id"], spec["series"], ok, summary)


def _run_semantic(res: _Result, conn) -> None:
    E_CHECKS = _expectations().E_CHECKS
    from .embed import query_embed

    with conn.cursor() as cur:
        cur.execute("set statement_timeout = '60s'")
        for spec in E_CHECKS:
            if spec["query"] is None:
                ok, summary = spec["assert"]([])
                res.add(spec["id"], "E", ok, summary)
                continue
            try:
                vec = query_embed(spec["query"])
                cur.execute(
                    """select * from internal.hybrid_search(
                         %(q)s, %(vec)s::extensions.halfvec(512), %(lim)s,
                         %(kinds)s, null, %(state)s, %(min_size)s)""",
                    {"q": spec["query"],
                     "vec": "[" + ",".join(f"{x:.6f}" for x in vec) + "]",
                     "lim": spec["limit"], "kinds": spec.get("kinds"),
                     "state": spec.get("state"),
                     "min_size": spec.get("min_size")})
                ok, summary = spec["assert"](cur.fetchall())
            except Exception as exc:
                conn.rollback()
                ok, summary = False, f"{type(exc).__name__}: {exc}"
            res.add(spec["id"], "E", ok, summary)


def _run_er(res: _Result, conn) -> None:
    exp = _expectations()
    ER_LINKED_GRANTS_FLOOR = exp.ER_LINKED_GRANTS_FLOOR
    ER_SPOT_CHECKS, ER_TIER_FLOORS = exp.ER_SPOT_CHECKS, exp.ER_TIER_FLOORS
    from .resolve.common import JOBS, wilson_low

    with conn.cursor() as cur:
        cur.execute("set statement_timeout = '120s'")
        # Recipient tiers vs recorded floors.
        cur.execute("""select method, count(*) from internal.recipient_matches
                       where status = 'auto' group by 1""")
        tiers = dict(cur.fetchall())
        for tier, floor in ER_TIER_FLOORS.items():
            n = int(tiers.get(tier, 0))
            res.add(f"ER-{tier}", "ER", n >= floor, f"{n:,} matches (floor {floor:,})")
        cur.execute("""select count(*) from internal.funding_events
                       where event_type = 'grant' and recipient_org_id is not null""")
        (linked,) = cur.fetchone()
        res.add("ER-linked", "ER", linked >= ER_LINKED_GRANTS_FLOOR,
                f"{linked:,} grant rows resolved (floor {ER_LINKED_GRANTS_FLOOR:,})")
        for name, sql, check in ER_SPOT_CHECKS:
            try:
                cur.execute(sql)
                ok = bool(check(cur.fetchall()))
            except Exception as exc:
                conn.rollback()
                ok = False
                name = f"{name} — {type(exc).__name__}"
            res.add("ER-spot", "ER", ok, name)
        # Link-job precision reports: SKIP until a job has applied; once
        # applied, an uncertified apply (forced) is a FAIL, not a shrug.
        for job_key, spec in JOBS.items():
            table, col = (("internal.organizations", "canonical_org_id")
                          if spec.entity_type == "organization"
                          else ("internal.people", "canonical_person_id"))
            cur.execute(f"select count({col}) from {table}")
            (n_canon,) = cur.fetchone()
            gate_where = spec.strata[spec.gate_stratum]
            cur.execute(f"""
                select count(*) filter (where l.label = 'match'), count(*)
                from internal.er_labels l
                join internal.entity_links el
                  on el.job = l.job and el.id_a = l.id_a and el.id_b = l.id_b
                where l.job = %(job)s and l.label <> 'unsure' and {gate_where}
                  and l.labeled_by not like '%%:parked'""",
                {"job": spec.job, "threshold": spec.apply_threshold})
            correct, n = cur.fetchone()
            low = wilson_low(correct or 0, n or 0)
            detail = (f"labels {correct or 0}/{n or 0}, Wilson low {low:.3f}, "
                      f"canonicalized {n_canon:,}")
            if n_canon == 0:
                res.skip(f"ER-{job_key}", "ER", f"not applied yet — {detail}")
            else:
                certified = (n or 0) >= 100 and low > 0.90
                res.add(f"ER-{job_key}", "ER", certified,
                        detail + ("" if certified else " — APPLIED WITHOUT CERTIFICATION"))


def parity(n: int = 50) -> int:
    """ProPublica Nonprofit Explorer API v2 spot-validation — REPORT-only.

    Network-dependent and comparing against a DERIVED source (ProPublica's own
    parse of the same IRS XML, with its own amended-return choices), so this
    never gates and is deliberately excluded from `eval all`. Mismatches
    inform; exact agreement on totals is strong parser corroboration.
    """
    import time

    import httpx

    with connect() as conn, conn.cursor() as cur:
        cur.execute("""
            select f.ein, f.tax_period, ff.total_revenue, ff.total_expenses,
                   ff.total_assets_eoy
            from internal.filings f
            join internal.filing_financials ff on ff.object_id = f.object_id
            where f.return_type = '990PF' and f.superseded_by_object_id is null
              and ff.total_revenue is not null
            order by random() limit %s""", (n,))
        sample = cur.fetchall()
        conn.rollback()

    agree = mismatch = missing = ahead = 0
    fields = (("totrevenue", 2), ("totexpns", 3), ("totassetsend", 4))
    with httpx.Client(timeout=30.0, headers={
            "User-Agent": "MortonLabs-funderdb parity check (zach@mortonlabs.ai)"}) as client:
        for ein, tax_period, *ours in sample:
            time.sleep(0.4)  # be polite to a free public API
            try:
                r = client.get("https://projects.propublica.org/nonprofits"
                               f"/api/v2/organizations/{int(ein)}.json")
                if r.status_code != 200:
                    missing += 1
                    print(f"  {ein} {tax_period}: HTTP {r.status_code}")
                    continue
                filings = r.json().get("filings_with_data") or []
            except httpx.HTTPError as exc:
                missing += 1
                print(f"  {ein} {tax_period}: {type(exc).__name__}")
                continue
            match = next((fl for fl in filings
                          if str(fl.get("tax_prd") or "") == tax_period), None)
            if match is None:
                missing += 1
                periods = sorted(str(fl.get("tax_prd") or "") for fl in filings)
                newest = periods[-1] if periods else None
                if newest and newest < tax_period:
                    ahead += 1
                    print(f"  {ein} {tax_period}: we are AHEAD — ProPublica's "
                          f"newest is {newest}")
                else:
                    print(f"  {ein} {tax_period}: no matching tax_prd "
                          f"(ProPublica has {periods[-3:] or 'none'})")
                continue
            diffs = []
            for key, idx in fields:
                theirs = match.get(key)
                if theirs is None or ours[idx - 2] is None:
                    continue
                if int(theirs) != int(ours[idx - 2]):
                    diffs.append(f"{key} ours={ours[idx - 2]:,} theirs={int(theirs):,}")
            if diffs:
                mismatch += 1
                print(f"  {ein} {tax_period}: " + "; ".join(diffs))
            else:
                agree += 1
    print(f"\nparity [REPORT]: {agree} agree · {mismatch} mismatch · "
          f"{missing} not comparable — of which {ahead} are filings we hold "
          f"and ProPublica has not published yet (of {len(sample)} sampled)")
    return 0


def run(series: str) -> int:
    res = _Result()
    with connect() as conn:
        if series in ("sql", "all"):
            _run_sql(res, conn)
        if series in ("semantic", "all"):
            _run_semantic(res, conn)
        if series in ("er", "all"):
            _run_er(res, conn)
        conn.rollback()  # read-only suite; never leave a transaction open

    n_pass = sum(1 for l in res.lines if l[2] == "PASS")
    print(f"\n{n_pass} PASS · {res.failed} FAIL · "
          f"{sum(1 for l in res.lines if l[2] in ('REPORT', 'SKIP'))} report/skip")
    print(f"\n-- paste-ready block for benchmarks/queries.sql "
          f"(append via a reviewed commit, never rewrite):")
    print(f"-- {date.today().isoformat()} `funderdb eval {series}` results:")
    for check_id, s, status, summary in res.lines:
        print(f"--   {check_id:>5} [{s}] {status}: {summary}")
    return 1 if res.failed else 0


def main(series: str) -> None:
    sys.exit(run(series))

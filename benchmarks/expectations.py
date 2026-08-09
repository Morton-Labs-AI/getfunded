"""Declarative check registry for `funderdb eval` (suite v2).

Three series:
  B  — the Phase-1 SQL benchmarks, executed VERBATIM from queries.sql
       (split on `-- B<n>.` headers; queries.sql stays the single
       human-readable record, append-never-rewrite). Assertions here are
       grown-DB-tolerant floors, not exact counts.
  E  — semantic evals over internal.hybrid_search (need a query embedding).
  ER — entity-resolution recomputations vs the recorded ER3 floors, plus
       precision reports from er_labels. Jobs that haven't applied yet
       SKIP (not FAIL) so `eval all` stays green through the gate ladder.

Each check: {id, series, assert: fn(rows) -> (ok: bool|None, summary)} —
ok=None means REPORT/SKIP (printed, never gates the exit code).
E-checks add query/kinds/org_types/state/min_size/limit.
"""

from __future__ import annotations

import re

MEDICAL_FUSION = re.compile(r"(bone|spinal|spine|protein|cell)\W{0,12}fusion", re.I)
OFF_DOMAIN = re.compile(r"energy|fusion|climate|plasma", re.I)


def _names(rows, col=0):
    return [str(r[col] or "") for r in rows]


# --- B-series: rows come from the verbatim queries.sql blocks ---------------

def b1(rows):
    names = " ".join(_names(rows)).upper()
    ok = len(rows) >= 7 and "INFUSE" in names
    infuse_flag = any("INFUSE" in str(r[0]).upper() and r[3] for r in rows)
    return ok and infuse_flag, (
        f"{len(rows)} programs; INFUSE present with funds_lab_not_company="
        f"{infuse_flag}")


def b2(rows):
    agencies = {r[0] for r in rows}
    return len(agencies) >= 5, f"{len(agencies)} distinct SBIR/STTR agencies"


def b3(rows):
    lc = [r for r in rows if "LOWERCARBON" in str(r[0]).upper()]
    crd_ok = any(str(r[6] or "") == "162946" for r in lc)
    prelude = [r for r in rows if "PRELUDE" in str(r[0]).upper()]
    return crd_ok, (
        f"Lowercarbon CRD 162946 {'resolved' if crd_ok else 'MISSING'}; "
        f"Prelude rows={len(prelude)} (documented absence expects 0 ADV/FormD)")


def b4(rows):
    return len(rows) >= 40, f"{len(rows)} climate/energy advisers (floor 40)"


def b5(rows):
    schmidt = sum(1 for r in rows if "SCHMIDT" in str(r[0]).upper())
    return schmidt >= 1, f"{schmidt} Schmidt-family foundation rows"


def b6(rows):
    return len(rows) >= 40, f"{len(rows)} energy/science foundations >$10M (floor 40)"


def b7(rows):
    return len(rows) >= 4, f"{len(rows)} IL science/energy foundations >$10M (floor 4)"


def b8(rows):
    return len(rows) >= 40, f"{len(rows)} energy/science grant rows (floor 40)"


def b9(rows):
    return len(rows) >= 40, f"{len(rows)} Reg D offerings in last 12mo (floor 40)"


def b10(rows):
    orphans = int(rows[0][1])
    return orphans == 0, f"{rows[0][0]} orgs, {orphans} provenance orphans (must be 0)"


# B12: the twelve published Topfer FY2024 figures, asserted exactly.
# (column index in the B12 select, expected value)
_TOPFER = [
    ("fmv_assets_eoy", 4, 28_351_327),
    ("contributions_received", 5, 50_000),
    ("dividends", 6, 353_266),
    ("net_gain_sale_assets", 7, 753_889),
    ("gross_sales_price", 8, 2_426_164),
    ("capital_gain_net_income", 9, 752_443),
    ("total_revenue", 10, 1_467_724),
    ("total_expenses", 11, 3_049_382),
    ("charitable_disbursements", 12, 2_512_983),
    ("net_assets_eoy", 13, 26_696_006),
    ("total_liabilities_eoy", 14, 0),
    ("officer_comp", 15, 0),
]


def b12(rows):
    if not rows:
        return False, "Topfer filing 202532979349100628 has no financials row"
    r = rows[0]
    bad = [f"{name}={r[i]}≠{want}" for name, i, want in _TOPFER
           if r[i] is None or int(r[i]) != want]
    if bad:
        return False, "Topfer mismatch: " + ", ".join(bad)
    return True, (f"all 12 published values exact; acct={r[3]}, "
                  f"qualifying_distributions={int(r[16]):,}, grant_rows={r[17]}")


def b13(rows):
    (with_events, multi_winner, superseded, pf_live, pf_detailed) = (
        int(rows[0][0]), int(rows[0][1]), int(rows[0][2]),
        int(rows[0][3]), int(rows[0][4]))
    coverage = pf_detailed / pf_live if pf_live else 0.0
    invariants_ok = with_events == 0 and multi_winner == 0
    ok = invariants_ok and coverage >= 0.98
    detail = (f"{with_events} superseded filings retain event rows (must be 0); "
              f"{multi_winner} multi-winner groups (must be 0); "
              f"{superseded:,} filings superseded; detail coverage "
              f"{pf_detailed:,}/{pf_live:,} live processed 990-PFs "
              f"({100 * coverage:.1f}%, floor 98%)")
    # A sub-floor coverage with clean invariants means the detail backfill is
    # mid-flight, not that supersession broke — say so instead of reading as
    # a correctness failure.
    if invariants_ok and not ok:
        detail += " — invariants CLEAN; detail backfill still running"
    return ok, detail


B_CHECKS = {  # queries.sql block number -> assert fn
    1: b1, 2: b2, 3: b3, 4: b4, 5: b5, 6: b6, 7: b7, 8: b8, 9: b9, 10: b10,
    12: b12, 13: b13,
}

# Inline SQL checks that are NOT in queries.sql (new in v2; append their
# first PASS results to queries.sql as a dated block via a reviewed commit).
SQL_INLINE = [
    {
        "id": "B5b", "series": "B",
        "sql": """select o.name, o.org_type, i.id_value
                  from internal.organizations o
                  join internal.org_identifiers i
                    on i.org_id = o.id and i.id_type = 'ein'
                  where i.id_value = '812567715'""",
        # The org row is the whole achievable gate. Stellar's grantmaking is a
        # DOCUMENTED STRUCTURAL ABSENCE: its EIN appears in zero e-file index
        # years (2021-2026) — as a $0-asset micro-charity it files the 990-N
        # postcard, which carries no Schedule I and no grant data. Verified
        # 2026-07-31 against all six staged index CSVs. Same honest-absence
        # doctrine as Prelude Ventures on the SEC side.
        "assert": lambda rows: (
            len(rows) >= 1,
            f"Stellar org row {'present as ' + rows[0][1] if rows else 'MISSING'}; "
            "grants structurally absent (990-N filer — no e-filed 990/EZ in any "
            "index year; documented absence)"),
    },
    {
        "id": "B11", "series": "B",
        # Web-facts containment (migration 0012): every org_web_facts row must
        # trace to a funder_website raw file under the non-republishable
        # publisher_website license, no public view may read the table, and no
        # published fact table may ever cite a website snapshot. rows_total=0
        # is a vacuous PASS (the table is human-gated and sparse by design).
        "sql": """select
                    (select count(*) from internal.org_web_facts) as rows_total,
                    (select count(*) from internal.org_web_facts w
                       left join internal.raw_files rf on rf.id = w.raw_file_id
                       left join internal.licensing_map lm
                         on lm.license_code = rf.license_code
                       where rf.sha256 is null
                          or rf.dataset_name is distinct from 'funder_website'
                          or coalesce(lm.republishable, true)) as violations,
                    (select count(*) from information_schema.view_table_usage
                       where table_schema = 'internal'
                         and table_name = 'org_web_facts'
                         and view_schema = 'public') as public_view_refs,
                    (select count(*) from internal.organizations o
                       join internal.raw_files rf on rf.id = o.raw_file_id
                       where rf.dataset_name = 'funder_website') as org_row_leak""",
        "assert": lambda rows: (
            rows[0][1] == 0 and rows[0][2] == 0 and rows[0][3] == 0,
            f"web-facts containment: {rows[0][0]} rows, {rows[0][1]} provenance "
            f"violations, {rows[0][2]} public-view refs, {rows[0][3]} org-row "
            "leaks" + (" (vacuous — no confirmed rows yet)" if rows[0][0] == 0 else "")),
    },
    {
        "id": "S1", "series": "S",
        # similar_orgs sanity (migration 0012) on the Topfer seed: 12 rows,
        # seed excluded, distances ascending in (0, 1). The HNSW≡exact and
        # filter-path equivalence proofs ran at migration time (recorded in
        # queries.sql 2026-08-01); this keeps the function's contract green.
        "sql": """select org_id::text, dist
                  from internal.similar_orgs('4f205ebb-9c46-4304-8594-814b32cbd29f')""",
        "assert": lambda rows: (
            len(rows) == 12
            and all(r[0] != "4f205ebb-9c46-4304-8594-814b32cbd29f" for r in rows)
            and all(0 < r[1] < 1 for r in rows)
            and all(rows[i][1] <= rows[i + 1][1] for i in range(len(rows) - 1)),
            f"similar_orgs(Topfer): {len(rows)} rows, dist "
            f"{rows[0][1]:.4f}..{rows[-1][1]:.4f} ascending, seed excluded"
            if rows else "similar_orgs returned no rows"),
    },
    # --- F-series: application posture, distributions, contact publication ---
    # Floors measured 2026-08-09 and set below the measurement so they survive
    # a growing DB; the partition identities are exact because they are
    # identities, not counts.
    {
        "id": "F1", "series": "F",
        # The posture partition must be TOTAL and DISJOINT. 'unknown' is an
        # absence of a statement, never a closed door.
        "sql": """select count(*),
                         count(*) filter (where application_posture = 'open'),
                         count(*) filter (where application_posture = 'preselected_only'),
                         count(*) filter (where application_posture = 'unknown')
                  from internal.mv_org_application_posture""",
        "assert": lambda rows: (
            (lambda n, o, p, u: (
                o + p + u == n and o >= 20_000 and p >= 80_000 and u >= 10_000,
                f"posture partition {o:,} open + {p:,} preselected + {u:,} unknown "
                f"= {o + p + u:,} of {n:,} orgs "
                f"({'total' if o + p + u == n else 'NOT TOTAL'}; "
                "floors 20,000/80,000/10,000)"))(*[int(x) for x in rows[0]])),
    },
    {
        "id": "F2", "series": "F",
        # THE correctness gate on the headline facet: an org can never read
        # 'open' when its own winning filing ticked preselected-only. The
        # rows_checked clause stops it passing vacuously on an empty MV.
        "sql": """select
                    (select count(*) from internal.mv_org_application_posture p
                     join internal.filing_application_info a on a.object_id = p.object_id
                     where p.application_posture = 'open' and a.only_preselected)
                      as violations,
                    (select count(*) from internal.mv_org_application_posture
                     where application_posture = 'open') as rows_checked""",
        "assert": lambda rows: (
            int(rows[0][0]) == 0 and int(rows[0][1]) >= 20_000,
            f"{int(rows[0][0])} 'open' orgs whose filing says preselected-only "
            f"(must be 0); {int(rows[0][1]):,} open rows checked (floor 20,000)"),
    },
    {
        "id": "F3", "series": "F",
        # Posture must come from the latest PARSED filing. Using the latest
        # filing of any kind lets the 35,648 never-zip-packaged filings win,
        # which measured 2026-08-09 mislabels 3,806 open foundations as
        # 'unknown' and inflates unknown 2.2x.
        "sql": """with truth as (
                    select distinct on (f.org_id) f.org_id, f.object_id
                    from internal.filings f
                    join internal.filing_financials ff on ff.object_id = f.object_id
                    where f.org_id is not null and f.return_type = '990PF'
                      and f.superseded_by_object_id is null
                    order by f.org_id, f.tax_period desc, f.object_id desc)
                  select count(*) filter (where t.object_id <> p.object_id), count(*)
                  from internal.mv_org_application_posture p
                  join truth t on t.org_id = p.org_id""",
        "assert": lambda rows: (
            int(rows[0][0]) == 0,
            f"{int(rows[0][0])} orgs whose posture comes from the wrong filing "
            f"(must be 0); {int(rows[0][1]):,} orgs checked"),
    },
    {
        "id": "F4", "series": "F",
        # The distributions screen sees what the BMF asset screen misses.
        # Measured 2026-08-09: 8,947 real grantmakers invisible at assets>$10M.
        "sql": """select
                    (select count(*) from internal.organizations o
                     join internal.mv_org_latest_financials m on m.org_id = o.id
                     where o.org_type = 'private_foundation'
                       and m.qualifying_distributions >= 500000
                       and coalesce(o.asset_amount, 0) < 10000000) as missed_by_assets,
                    (select count(*) from internal.mv_org_latest_financials
                     where qualifying_distributions < 0) as negative""",
        "assert": lambda rows: (
            int(rows[0][0]) >= 8_000 and int(rows[0][1]) == 0,
            f"{int(rows[0][0]):,} grantmakers distributing >=$500k that a "
            f">$10M asset screen misses (floor 8,000); "
            f"{int(rows[0][1])} negative distributions (must be 0)"),
    },
    {
        "id": "F5", "series": "F",
        # Contact publication containment. Same doctrine as B11: every clause
        # is a zero, and the summary says so when the public set is empty.
        "sql": """select
                    (select count(*) from internal.contact_channels
                     where publishability = 'public' and privacy_tier <> 'green'),
                    (select count(*) from internal.contact_channels
                     where publishability = 'public' and channel_type = 'email'
                       and not is_role_based),
                    (select count(*) from internal.contact_channels c
                     join internal.raw_files rf on rf.id = c.raw_file_id
                     join internal.licensing_map lm on lm.license_code = rf.license_code
                     where c.publishability = 'public' and not lm.republishable),
                    (select count(*) from internal.contact_channels
                     where privacy_tier = 'red'),
                    (select count(*) from internal.contact_channels
                     where publishability = 'public')""",
        "assert": lambda rows: (
            all(int(x) == 0 for x in rows[0][:4]),
            f"public contacts: {int(rows[0][4]):,} rows; "
            f"{int(rows[0][0])} non-green, {int(rows[0][1])} non-role-based emails, "
            f"{int(rows[0][2])} non-republishable, {int(rows[0][3])} red "
            "(all must be 0)"
            + (" (vacuous — no public rows yet)" if int(rows[0][4]) == 0 else "")),
    },
    {
        "id": "F6", "series": "F",
        # Topfer as the known-good profile, and the falsifiable form of
        # "never publish a named individual's address": its Part XV email is
        # ALAN_TOPFER@CASTLETOP.ORG and it must never reach the public view.
        "sql": """select
                    (select application_posture from internal.mv_org_application_posture
                     where org_id = '4f205ebb-9c46-4304-8594-814b32cbd29f'),
                    (select app_state from internal.mv_org_application_posture
                     where org_id = '4f205ebb-9c46-4304-8594-814b32cbd29f'),
                    (select qualifying_distributions from internal.mv_org_latest_financials
                     where org_id = '4f205ebb-9c46-4304-8594-814b32cbd29f'),
                    (select count(*) from public.contact_channels
                     where org_id = '4f205ebb-9c46-4304-8594-814b32cbd29f'
                       and lower(value) like '%castletop%'),
                    (select count(*) from internal.contact_channels
                     where org_id = '4f205ebb-9c46-4304-8594-814b32cbd29f'
                       and publishability = 'internal_only')""",
        "assert": lambda rows: (
            rows[0][0] == "open" and rows[0][1] == "TX"
            and int(rows[0][2] or 0) == 2_512_983 and int(rows[0][3]) == 0
            and int(rows[0][4]) >= 1,
            f"Topfer: posture={rows[0][0]} state={rows[0][1]} "
            f"distributions={int(rows[0][2] or 0):,}; "
            f"{int(rows[0][3])} castletop.org addresses in the public view "
            f"(must be 0); {int(rows[0][4])} withheld internally"),
    },
    {
        "id": "F7", "series": "F",
        # Recipient-side vetting floor + an honesty TRIPWIRE. Clause (b)
        # asserts charity core-form financials do NOT exist; the day that
        # phase lands F7 FAILS, which forces the "what this can't tell you
        # yet" copy to be updated instead of quietly going stale.
        "sql": """select
                    (select count(distinct funder_org_id) from internal.funding_events
                     where recipient_org_id = (
                       select org_id from internal.org_identifiers
                       where id_type = 'ein' and id_value = '042103594' limit 1)
                       and event_type = 'grant'),
                    (select count(distinct fiscal_year) from internal.funding_events
                     where recipient_org_id = (
                       select org_id from internal.org_identifiers
                       where id_type = 'ein' and id_value = '042103594' limit 1)
                       and event_type = 'grant'),
                    (select count(*) from internal.filings f
                     join internal.filing_financials ff on ff.object_id = f.object_id
                     where f.return_type = '990')""",
        "assert": lambda rows: (
            int(rows[0][0]) >= 5 and int(rows[0][1]) >= 2 and int(rows[0][2]) == 0,
            f"MIT as a vetting subject: {int(rows[0][0])} distinct funders "
            f"(floor 5) across {int(rows[0][1])} fiscal years (floor 2); "
            f"charity 990 core-form financials on file: {int(rows[0][2])} "
            "(must be 0 — when this fires, update CHARITY_VETTING_LIMIT_NOTE)"),
    },
]

# --- E-series ---------------------------------------------------------------

def e1(rows):
    top10 = rows[:10]
    bad = [r for r in top10 if MEDICAL_FUSION.search(str(r[11] or "") + " " + str(r[4] or ""))]
    return not bad, (
        f"top10 medical-fusion contaminants: {len(bad)} (must be 0)")


def e1b(rows):
    top6 = " ".join(str(r[4] or "").upper() for r in rows[:6])
    hits = sum(1 for k in ("INFUSE", "FIRE", "MILESTONE", "ARPA-E") if k in top6)
    return hits >= 3, f"{hits}/4 fusion programs in top 6 (need >=3)"


def e2(rows):
    top10_kinds = {str(r[3]) for r in rows[:10]}
    lc_rank = next((i + 1 for i, r in enumerate(rows)
                    if "LOWERCARBON" in str(r[4] or "").upper()), None)
    ok = top10_kinds <= {"adviser"} and lc_rank is not None and lc_rank <= 100
    return ok, f"top10 all advisers={top10_kinds <= {'adviser'}}; Lowercarbon rank={lc_rank} (need <=100)"


def e3(rows):
    top3 = " ".join(str(r[4] or "").upper() for r in rows[:3])
    ok = "INFUSE" in top3 or "ARPA-E" in top3
    return ok, f"top3: {top3[:80]}"


def e4(_rows):
    return None, ("REPORT-ONLY (end-to-end through the analyst; recorded "
                  "2026-07-26: discovery+evidence pairing incl. mid-answer "
                  "self-correction — not asserted headlessly)")


def e5(rows):
    # Fixture updated 2026-07-31 when grantmaking charities joined the corpus:
    # the climate-philanthropy heavyweights (ClimateWorks, Energy Foundation,
    # Breakthrough Energy, Hewlett) are mostly public charities and displaced
    # the original private-foundation trio — a better answer, not a
    # regression. Set spans both org populations; floor raised to 2.
    known = ("SEQUOIA CLIMATE", "SEA CHANGE", "CO2 FOUNDATION",
             "CLIMATEWORKS", "ENERGY FOUNDATION", "BREAKTHROUGH ENERGY",
             "HEWLETT")
    top10 = " ".join(str(r[4] or "").upper() for r in rows[:10])
    hits = sum(1 for k in known if k in top10)
    return hits >= 2, f"{hits}/{len(known)} known climate funders in top 10 (need >=2)"


def e7(rows):
    top10 = rows[:10]
    bad = [r for r in top10 if OFF_DOMAIN.search(str(r[4] or "") + " " + str(r[11] or ""))]
    return not bad, f"negative control: {len(bad)} energy/climate orgs in top 10 (must be 0)"


def e8(rows):
    wrong = [r for r in rows if r[6] and str(r[6]) != "CA"]
    return not wrong, f"state filter: {len(wrong)} non-CA rows of {len(rows)} (must be 0)"


def e9(rows):
    small = [r for r in rows if r[7] is not None and float(r[7]) < 1e9]
    return not small, f"min_size filter: {len(small)} rows under $1B of {len(rows)} (must be 0)"


def e10(rows):
    lc_rank = next((i + 1 for i, r in enumerate(rows)
                    if "LOWERCARBON" in str(r[4] or "").upper()), None)
    return lc_rank is not None and lc_rank <= 5, \
        f"FTS leg: Lowercarbon rank={lc_rank} for its own name (need <=5)"


TOPFER_ORG_ID = "4f205ebb-9c46-4304-8594-814b32cbd29f"
SCIENCE_FUNDERS = ("SIMONS", "SLOAN", "MOORE", "KAVLI", "RESEARCH CORPORATION",
                   "BURROUGHS WELLCOME", "KECK", "TEMPLETON", "PACKARD", "SCHMIDT")


def _no_row_violates(rows, idx, pred, label):
    """E8/E9 template: assert ZERO returned rows violate the filter."""
    bad = [r for r in rows if not pred(r[idx])]
    return not bad, f"{len(bad)} of {len(rows)} rows violate {label} (must be 0)"


def e11(rows):  # Chicago
    ok, msg = _no_row_violates(rows, 6, lambda s: s == "IL", "state=IL")
    named = sum(1 for r in rows[:20] if "CHICAGO" in str(r[4] or "").upper())
    return ok and named >= 2, f"{msg}; {named} top-20 names contain CHICAGO (need >=2)"


def e12(rows):  # Denver — thinner corpus (899 docs), so a lower name floor
    ok, msg = _no_row_violates(rows, 6, lambda s: s == "CO", "state=CO")
    named = sum(1 for r in rows[:20]
                if any(k in str(r[4] or "").upper() for k in ("DENVER", "COLORADO")))
    return ok and named >= 1, f"{msg}; {named} top-20 names contain DENVER/COLORADO (need >=1)"


def e13(rows):  # Austin/Texas anchored on Topfer. Rank recorded, see queries.sql.
    ok, msg = _no_row_violates(rows, 6, lambda s: s == "TX", "state=TX")
    rank = next((i + 1 for i, r in enumerate(rows) if str(r[1]) == TOPFER_ORG_ID), None)
    return ok and rank is not None, (
        f"{msg}; Topfer rank={rank if rank else 'ABSENT'} of {len(rows)}"
        + ("" if rank else " — aggregate dilution, record and investigate"))


def e14(rows):  # scientific philanthropies
    # Count matching ROWS, not distinct brand keywords. Counting keywords
    # punishes the ranking for a correct result: Heising-Simons and the Simons
    # Foundation are two different real science funders that both belong in
    # the top 20, and collapsing them to one 'SIMONS' hit read as a miss.
    # The brand list is also only a proxy — the Keck Observatory surfaces as
    # its operating entity, "California Association for Research in Astronomy".
    hits = [str(r[4]) for r in rows[:20]
            if any(k in str(r[4] or "").upper() for k in SCIENCE_FUNDERS)]
    return len(hits) >= 3, (
        f"{len(hits)} known science funders in top 20 (need >=3)"
        + (f": {', '.join(h[:28] for h in hits[:4])}" if hits else ""))


def e15(rows):  # Morton Labs fusion, filtered to open-to-apply
    ok, msg = _no_row_violates(rows, 12, lambda p: p == "open", "app_posture=open")
    bad = [r for r in rows[:10]
           if MEDICAL_FUSION.search(str(r[11] or "") + " " + str(r[4] or ""))]
    return ok and not bad, f"{msg}; {len(bad)} medical-fusion contaminants in top 10"


def e16(rows):  # min_distributions respected
    return _no_row_violates(
        rows, 13, lambda d: d is not None and d >= 1_000_000,
        "annual_distributions >= $1M")


# hybrid_search returns (doc_id, org_id, program_id, doc_kind, name, org_type,
# state, size_amount, vec_rank, fts_rank, rrf, snippet, app_posture,
# annual_distributions) — indexes 0..13. 12/13 appended by migration 0020, so
# every pre-existing positional assertion above stays valid.
E_CHECKS = [
    {"id": "E1", "query": "fusion energy simulation software",
     "kinds": None, "limit": 20, "assert": e1},
    {"id": "E1b", "query": "foundations and programs funding fusion energy and plasma physics",
     "kinds": ["foundation", "program"], "limit": 20, "assert": e1b},
    {"id": "E2", "query": "climate tech venture capital",
     "kinds": ["adviser"], "limit": 200, "assert": e2},
    {"id": "E3", "query": "funding for fusion energy startups without giving up equity",
     "kinds": ["program"], "limit": 10, "assert": e3},
    {"id": "E4", "query": None, "kinds": None, "limit": 0, "assert": e4},
    {"id": "E5", "query": "climate adaptation and clean energy",
     "kinds": ["foundation"], "limit": 20, "assert": e5},
    {"id": "E7", "query": "youth ballet education programs",
     "kinds": None, "limit": 20, "assert": e7},
    {"id": "E8", "query": "climate and clean energy",
     "kinds": ["foundation"], "state": "CA", "limit": 30, "assert": e8},
    {"id": "E9", "query": "science research",
     "kinds": ["foundation"], "min_size": 1_000_000_000, "limit": 30, "assert": e9},
    {"id": "E10", "query": "lowercarbon capital",
     "kinds": ["adviser"], "limit": 20, "assert": e10},
    # --- F6 scenario checks (2026-08-09) ---------------------------------
    {"id": "E11", "query": "Chicago community foundations funding neighborhood "
                           "and youth programs",
     "kinds": ["foundation"], "state": "IL", "limit": 30, "assert": e11},
    {"id": "E12", "query": "Denver Colorado foundations funding local community "
                           "organizations",
     "kinds": ["foundation"], "state": "CO", "limit": 30, "assert": e12},
    {"id": "E13", "query": "Austin Texas family foundations funding local "
                           "community and education",
     "kinds": ["foundation"], "state": "TX", "limit": 50, "assert": e13},
    {"id": "E14", "query": "foundations funding basic scientific research, "
                           "instruments, and early-career scientists",
     "kinds": ["foundation"], "limit": 20, "assert": e14},
    # The check that catches a positional mis-binding in the UI's
    # semantic_funder_search call: a wrong order silently filters on the
    # wrong argument rather than erroring.
    {"id": "E15", "query": "fusion energy, plasma physics, and advanced "
                           "computational science",
     "kinds": ["foundation"], "app_postures": ["open"], "limit": 30, "assert": e15},
    {"id": "E16", "query": "science education",
     "kinds": ["foundation"], "min_distributions": 1_000_000, "limit": 30,
     "assert": e16},
]

# --- ER-series --------------------------------------------------------------

# Floors from the recorded ER3 results (2026-07-27); grown-DB tolerant
# (re-running resolve recipients after back-years can only add matches).
ER_TIER_FLOORS = {"tier1": 349_293, "tier2": 784, "tier3": 57_813}
ER_LINKED_GRANTS_FLOOR = 886_763

ER_SPOT_CHECKS = [
    ("MIT resolves in MA (tier1)",
     """select m.method from internal.recipient_matches m
        join internal.organizations o on o.id = m.org_id
        where m.recipient_name_normalized =
              internal.norm_name('Massachusetts Institute of Technology')
          and m.recipient_state = 'MA'""",
     lambda rows: rows and rows[0][0] == "tier1"),
    ("Princeton resolves in NJ (tier1)",
     # The recorded ER3 spot check matched the plain as-reported name;
     # 'TRUSTEES OF PRINCETON UNIVERSITY' exists too but resolved in WA.
     """select m.method from internal.recipient_matches m
        where m.recipient_name_normalized =
              internal.norm_name('Princeton University')
          and m.recipient_state = 'NJ'""",
     lambda rows: rows and rows[0][0] == "tier1"),
    ("zero placeholder-text matches",
     """select count(*) from internal.recipient_matches
        where recipient_name_normalized in (
          internal.norm_name('VARIOUS INDIVIDUALS'),
          internal.norm_name('SEE ATTACHED'),
          internal.norm_name('SEE ATTACHED LIST'),
          internal.norm_name('HIPPA REGULATIONS PREVENT THE LISTING OF NAMES'))""",
     lambda rows: int(rows[0][0]) == 0),
]

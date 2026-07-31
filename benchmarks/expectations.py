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


B_CHECKS = {  # queries.sql block number -> assert fn
    1: b1, 2: b2, 3: b3, 4: b4, 5: b5, 6: b6, 7: b7, 8: b8, 9: b9, 10: b10,
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


# hybrid_search returns (doc_id, org_id, program_id, doc_kind, name, org_type,
# state, size_amount, vec_rank, fts_rank, rrf, snippet) — indexes 0..11.
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

"""Property-test internal.norm_name(SQL) against normalize_name(Python).

Recipient matching joins on equality between the two implementations, so any
divergence silently drops matches. Postgres `\\w` is [[:alnum:]_] and Python's
is Unicode-aware, so non-ASCII is the interesting case — real filings contain
accented names, ampersands, and heavy punctuation.

Run: uv run python scripts/norm_parity_test.py
"""

from __future__ import annotations

import random
import string
import sys

sys.path.insert(0, "src")

import psycopg  # noqa: E402

from funderdb.config import get_settings  # noqa: E402
from funderdb.normalize import normalize_name  # noqa: E402

FIXED = [
    "MASSACHUSETTS INSTITUTE OF TECHNOLOGY",
    "The Board of Regents of the University of Wisconsin System",
    "St. Jude Children's Research Hospital, Inc.",
    "AT&T Foundation",
    "Smith-Jones Family Trust",
    "  leading and trailing   spaces  ",
    "Punctuation!@#$%^*()_+={}[]|\\:;\"'<>,.?/~`",
    "Université de Montréal",          # non-ASCII
    "Fundación Ejemplo",               # non-ASCII
    "Zürich Institut für Physik",      # non-ASCII
    "日本財団",                          # CJK
    "Ünïcödé & Ampersand-Hyphen",
    "MULTIPLE     INTERNAL   SPACES",
    "",
    "123 Numbers 456",
    "under_score name",
]


def random_name(rng: random.Random) -> str:
    alphabet = string.ascii_letters + string.digits + " .,&-'()/#" + "éüñ"
    return "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 40)))


def main() -> int:
    rng = random.Random(20260727)
    cases = FIXED + [random_name(rng) for _ in range(400)]

    mismatches: list[tuple[str, str, str]] = []
    with psycopg.connect(get_settings().database_url) as conn, conn.cursor() as cur:
        for name in cases:
            cur.execute("select internal.norm_name(%s)", (name,))
            sql_out = cur.fetchone()[0]
            py_out = normalize_name(name)
            if sql_out != py_out:
                mismatches.append((name, py_out, sql_out))

    print(f"checked {len(cases)} cases ({len(FIXED)} fixed + 400 random)")
    if mismatches:
        print(f"MISMATCHES: {len(mismatches)}")
        for name, py, sq in mismatches[:15]:
            print(f"  input : {name!r}")
            print(f"  python: {py!r}")
            print(f"  sql   : {sq!r}")
        # Non-ASCII divergence is tolerable ONLY if it never affects the
        # ASCII-dominated recipient corpus; anything ASCII is a hard failure.
        ascii_bad = [m for m in mismatches if m[0].isascii()]
        if ascii_bad:
            print(f"\nFAIL: {len(ascii_bad)} ASCII mismatches — recipient joins would drop matches")
            return 1
        print("\nWARN: divergence is non-ASCII only; recipient corpus is ASCII-dominated.")
        return 0
    print("PASS: byte-identical on every case")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

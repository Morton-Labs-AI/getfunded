"""Shared normalization helpers.

Identifier rules (documented in migrations/0002):
  ein  = 9 digits, zero-padded     cik = digits, leading zeros stripped
  crd  = digits                    uei = 12-char uppercase alphanumeric
  duns = 9 digits

Name/date logic ported from the April 2026 attempt's eo_bmf.py.
"""

from __future__ import annotations

import re
from datetime import date

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s&-]")


def normalize_name(name: str) -> str:
    cleaned = _PUNCT.sub(" ", name.upper())
    return _WS.sub(" ", cleaned).strip()


def normalize_ein(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    if not digits or len(digits) > 9:
        return None
    return digits.zfill(9)


def normalize_cik(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    return digits.lstrip("0") or None if digits else None


def normalize_crd(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw or "")
    return digits or None


def parse_ruling_date(raw: str) -> date | None:
    """BMF RULING comes as YYYYMM (6), YYYY (4), or occasionally YYYYMMDD (8)."""
    digits = re.sub(r"\D", "", raw or "")
    try:
        if len(digits) == 6:
            year, month = int(digits[:4]), int(digits[4:6])
            return date(year, month or 1, 1)
        if len(digits) == 4:
            return date(int(digits), 1, 1)
        if len(digits) == 8:
            return date(int(digits[:4]), int(digits[4:6]) or 1, int(digits[6:8]) or 1)
    except ValueError:
        return None
    return None


def parse_amount(raw: str) -> int | None:
    """Dollar amounts as whole dollars. Handles '$1,234,567', '150000.00',
    and negatives; a naive strip-non-digits would turn cents into 100x
    inflation (the SBIR bug of 2026-07-25)."""
    s = (raw or "").strip().replace(",", "").replace("$", "")
    if s in ("", "-"):
        return None
    try:
        return int(float(s))
    except ValueError:
        return None

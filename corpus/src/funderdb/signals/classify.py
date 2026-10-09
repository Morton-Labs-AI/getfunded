"""Classify a fetched press release into a funder signal.

Live mode calls Claude with a structured-output schema (the SDK's
``messages.parse``) and then VERIFIES every excerpt the model cites against
the page text: a field whose evidence cannot be found on the page is dropped,
not trusted. ``SIGNALS_AI_MODE=mock`` runs a deterministic keyword classifier
so the whole pipeline works token-free in development and in the weekly suite.

Vocabulary mirrors the CHECK constraints in migrations/0032_funder_signals.sql.
A value the database would reject must be impossible to produce here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from .fetch import Article

SignalType = Literal[
    "capital_commitment", "program_launch", "rfp_open", "deadline", "grant_announced",
    "investment_announced", "fund_close", "strategy_shift", "leadership_change",
    "partnership", "event", "other",
]
AmountKind = Literal["total_commitment", "annual_budget", "per_award", "single_award",
                     "fund_size", "range", "other"]
Instrument = Literal["grant", "pri", "mri", "equity", "debt", "guarantee", "prize", "contract",
                     "technical_assistance", "unspecified"]
Recipient = Literal["nonprofit", "for_profit", "fund", "government", "academic", "individual",
                    "unspecified"]
Sector = Literal[
    "climate", "clean_energy", "nuclear_energy", "energy_other", "environment_conservation",
    "health", "education", "housing", "economic_opportunity", "journalism_media",
    "democracy_civic", "arts_culture", "science_research", "criminal_justice",
    "international_development", "human_services", "other",
]
Relevance = Literal["high", "medium", "low", "none"]
EvidenceField = Literal["headline", "published_at", "signal_type", "amount", "instruments",
                        "eligible_recipients", "sectors", "geographies", "horizon_end",
                        "mentioned_orgs"]


class Evidence(BaseModel):
    field: EvidenceField
    excerpt: str = Field(description="A short verbatim passage copied from the page, 8-240 characters.")


class SignalClassification(BaseModel):
    """What the page says, in the corpus vocabulary. Null means the page does not say."""

    is_funding_signal: bool = Field(
        description="True only if the page announces something that changes what, whom or how "
                    "this funder funds (new money, program, call, deadline, award, investment, "
                    "fund close, strategy, leadership). A blog essay or event recap is false.")
    relevance: Relevance
    headline: str | None
    published_at: str | None = Field(
        description="ISO date YYYY-MM-DD if the page states a publication date; else null.")
    signal_type: SignalType
    amount_usd: float | None = Field(
        description="A dollar figure stated on the page, in USD, as a number. Null if none is "
                    "stated or the currency is not USD. Never estimate.")
    amount_kind: AmountKind | None
    instruments: list[Instrument]
    eligible_recipients: list[Recipient] = Field(
        description="Who can receive the money according to the page. 'for_profit' only when the "
                    "page says companies, startups, enterprises or businesses are eligible or "
                    "were funded.")
    sectors: list[Sector]
    geographies: list[str] = Field(description="Countries, states, regions or cities named as a focus.")
    horizon_end: str | None = Field(
        description="ISO date for the end of a stated period ('through 2028' -> 2028-12-31); else null.")
    summary: str = Field(
        description="Two sentences in your own words: what was announced and who it affects. "
                    "No quotation; no claims absent from the page.")
    action_hint: str | None = Field(
        description="One sentence on who should act and how, if the page gives a route "
                    "(a contact, a form, a program name). Else null.")
    mentioned_orgs: list[str] = Field(
        description="Other organizations named as partners, recipients or investees.")
    evidence: list[Evidence] = Field(
        description="One verbatim excerpt per populated field, copied exactly from the page.")
    confidence: float = Field(ge=0.0, le=1.0)


@dataclass
class ClassifyResult:
    classification: SignalClassification
    model: str
    violations: list[str]      # evidence that could not be found on the page
    usage: dict | None = None


SYSTEM = """You classify funder press releases for a public database that fundraisers rely on.
Read the page text and fill the schema using ONLY what the page states.

Rules you must not break:
- Unknown is null or an empty list. Never estimate an amount, a date or an eligibility rule.
- amount_usd is a number in USD stated on the page ("$750 million" -> 750000000). Other
  currencies -> null, and mention the stated figure in the summary.
- eligible_recipients: "for_profit" only when the page says companies, startups, enterprises
  or businesses receive or may receive funding (e.g. mission-related investments, equity).
  "nonprofit" when grants, program-related investments or nonprofit grantees are named.
- instruments: pri = program-related investment; mri = mission-related investment.
- The summary is your own paraphrase. It never asserts that the funder is interested in
  any particular applicant.
- For every field you populate, add one evidence item with an excerpt copied verbatim from
  the page (8-240 characters). A field without an excerpt will be discarded.
- is_funding_signal is false for essays, event recaps, staff profiles and general news that do
  not change what, whom or how the funder funds; set relevance to "none" in that case."""


# ---------------------------------------------------------------------------
# Live classification
# ---------------------------------------------------------------------------
def _user_prompt(article: Article, publisher_hint: str | None) -> str:
    parts = [
        f"URL: {article.url}",
        f"Publisher (from our watch list, may be null): {publisher_hint or 'null'}",
        f"Extracted title: {article.title or 'null'}",
        f"Extracted publication date: {article.published_at.isoformat() if article.published_at else 'null'}"
        f" (evidence: {article.date_evidence or 'none'})",
        "",
        "PAGE TEXT:",
        article.text or "(no readable text was extracted)",
    ]
    return "\n".join(parts)


def classify_live(article: Article, publisher_hint: str | None, *, model: str,
                  api_key: str | None) -> ClassifyResult:
    import anthropic  # imported lazily: the corpus installs without an API key

    client = anthropic.Anthropic(api_key=api_key) if api_key else anthropic.Anthropic()
    response = client.messages.parse(
        model=model,
        max_tokens=4000,
        system=SYSTEM,
        messages=[{"role": "user", "content": _user_prompt(article, publisher_hint)}],
        output_format=SignalClassification,
    )
    if response.stop_reason == "refusal":
        details = getattr(response, "stop_details", None)
        raise RuntimeError(f"model refused to classify {article.url}: "
                           f"{getattr(details, 'category', None)}")
    parsed = response.parsed_output
    if parsed is None:
        raise RuntimeError(f"model returned no structured output for {article.url}")
    usage = None
    if response.usage is not None:
        usage = {"input_tokens": response.usage.input_tokens,
                 "output_tokens": response.usage.output_tokens}
    verified, violations = verify_evidence(parsed, article)
    return ClassifyResult(verified, response.model, violations, usage)


# ---------------------------------------------------------------------------
# Evidence verification — the model cites; we check.
# ---------------------------------------------------------------------------
def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9$%.]+", " ", s.lower()).strip()


def verify_evidence(cls: SignalClassification, article: Article) -> tuple[SignalClassification, list[str]]:
    haystack = _norm(f"{article.title or ''}\n{article.text}")
    found: set[str] = set()
    violations: list[str] = []
    kept: list[Evidence] = []
    for ev in cls.evidence:
        needle = _norm(ev.excerpt)
        if len(needle) >= 6 and needle in haystack:
            found.add(ev.field)
            kept.append(ev)
        else:
            violations.append(f"{ev.field}: excerpt not on page: {ev.excerpt[:80]!r}")
    data = cls.model_dump()
    data["evidence"] = [e.model_dump() for e in kept]
    # Fields that need an on-page excerpt to survive. Headline and date may
    # also come from our own extraction, so they are not dropped here.
    if "amount" not in found:
        if data["amount_usd"] is not None:
            violations.append("amount_usd dropped: no verbatim excerpt")
        data["amount_usd"] = None
        data["amount_kind"] = None
    if "eligible_recipients" not in found and data["eligible_recipients"]:
        violations.append("eligible_recipients dropped: no verbatim excerpt")
        data["eligible_recipients"] = []
    if "instruments" not in found and data["instruments"]:
        violations.append("instruments dropped: no verbatim excerpt")
        data["instruments"] = []
    if "horizon_end" not in found:
        data["horizon_end"] = None
    if "mentioned_orgs" not in found:
        data["mentioned_orgs"] = []
    try:
        return SignalClassification.model_validate(data), violations
    except ValidationError as exc:  # pragma: no cover - model_dump round-trips
        raise RuntimeError(f"classification failed re-validation: {exc}") from exc


# ---------------------------------------------------------------------------
# Mock classification — deterministic, token-free, honest about being a mock.
# ---------------------------------------------------------------------------
_AMOUNT = re.compile(r"\$\s?(\d{1,3}(?:[,\d]{0,12})(?:\.\d+)?)\s*(billion|million|bn|mm|m|b|k|thousand)?\b", re.I)
_MULT = {"billion": 1e9, "bn": 1e9, "b": 1e9, "million": 1e6, "mm": 1e6, "m": 1e6,
         "k": 1e3, "thousand": 1e3, None: 1.0, "": 1.0}
_SECTOR_WORDS: list[tuple[Sector, str]] = [
    ("nuclear_energy", r"\bnuclear|fission|fusion\b"),
    ("clean_energy", r"clean energy|renewable|solar|wind power|geothermal|energy transition|decarboni"),
    ("climate", r"\bclimate\b|carbon|emissions|net.zero"),
    ("environment_conservation", r"conservation|biodiversity|ocean|forest|wildlife"),
    ("health", r"\bhealth|medical|hospital|disease|patients?\b"),
    ("education", r"\beducation|students?|schools?|universit"),
    ("housing", r"\bhousing|homeless|affordable homes"),
    ("journalism_media", r"journalism|newsroom|local news|media\b"),
    ("democracy_civic", r"democracy|civic|voting|elections?\b"),
    ("criminal_justice", r"criminal justice|incarcerat|jail|prison|policing"),
    ("economic_opportunity", r"economic (opportunity|mobility|development)|inclusive economy|small business|jobs\b"),
    ("science_research", r"\bresearch|scientific|laboratory|\bscience\b"),
    ("arts_culture", r"\barts?\b|culture|museum|artists?\b"),
    ("international_development", r"global south|developing countries|africa|international development|humanitarian"),
    ("human_services", r"food security|hunger|child welfare|social services"),
]


def _excerpt(text: str, rx: re.Pattern[str], field: EvidenceField) -> Evidence | None:
    m = rx.search(text)
    if not m:
        return None
    start = max(0, m.start() - 60)
    end = min(len(text), m.end() + 80)
    return Evidence(field=field, excerpt=text[start:end].strip()[:240])


def classify_mock(article: Article, publisher_hint: str | None) -> ClassifyResult:
    text = f"{article.title or ''}\n{article.text}"
    low = text.lower()
    evidence: list[Evidence] = []

    amount = None
    amount_kind: AmountKind | None = None
    m = _AMOUNT.search(text)
    if m:
        try:
            amount = float(m[1].replace(",", "")) * _MULT.get((m[2] or "").lower(), 1.0)
            amount_kind = "total_commitment"
            ev = _excerpt(text, _AMOUNT, "amount")
            if ev:
                evidence.append(ev)
        except ValueError:
            amount = None

    rules: list[tuple[SignalType, str]] = [
        ("rfp_open", r"request for proposals|\brfp\b|applications? (are|is) (now )?open|call for (proposals|applications)|now accepting"),
        ("deadline", r"\bdeadline\b|applications? (are )?due|closes? on"),
        ("fund_close", r"final close|first close|closes? (its )?(\$|fund)|raised \$|oversubscribed"),
        ("investment_announced", r"invest(s|ed|ment) in\b|leads? (a |the )?(seed|series)|equity investment in"),
        ("grant_announced", r"\bawards? \$|grants? (to|awarded)|announces? (new )?grants|\bgrantees\b"),
        ("leadership_change", r"\bappoints?\b|named (as )?(president|director|chief|managing)|joins (the )?(foundation|team) as|steps? down"),
        ("capital_commitment", r"\bcommits?\b|\bdedicat(e|es|ing)\b|\bpledg(e|es|ing)\b|\ballocat(e|es|ing)\b|increases? (its )?(commitment|allocation)"),
        ("program_launch", r"\blaunch(es|ed|ing)?\b|introduc(es|ing)|new (program|initiative|fund)\b"),
        ("strategy_shift", r"new strategy|strategic (plan|direction)|will (now )?focus|shifts? (its )?focus|exits?\b"),
        ("partnership", r"\bpartner(s|ship|ing)?\b|\bconsortium\b|\bcollaborat"),
        ("event", r"\bwebinar\b|\bconvening\b|\bsummit\b|\bconference\b|report (launch|release)"),
    ]
    signal_type: SignalType = "other"
    for st, pat in rules:
        rx = re.compile(pat, re.I)
        if rx.search(text):
            signal_type = st
            ev = _excerpt(text, rx, "signal_type")
            if ev:
                evidence.append(ev)
            break
    if amount and signal_type in ("other", "partnership", "event"):
        signal_type = "capital_commitment"

    recipients: list[Recipient] = []
    rx_np = re.compile(r"non-?profits?|charit(y|ies|able)|501\(c\)", re.I)
    rx_fp = re.compile(r"for-?profit|compan(y|ies)|start-?ups?|enterprises?|businesses|entrepreneurs?", re.I)
    rx_fund = re.compile(r"fund managers?|\bfunds\b|emerging managers", re.I)
    if rx_np.search(text):
        recipients.append("nonprofit")
        ev = _excerpt(text, rx_np, "eligible_recipients")
        if ev:
            evidence.append(ev)
    if rx_fp.search(text):
        recipients.append("for_profit")
        if not any(e.field == "eligible_recipients" for e in evidence):
            ev = _excerpt(text, rx_fp, "eligible_recipients")
            if ev:
                evidence.append(ev)
    if rx_fund.search(text):
        recipients.append("fund")

    instruments: list[Instrument] = []
    for inst, pat in (("pri", r"program-related investments?|\bPRIs?\b"),
                      ("mri", r"mission-related investments?|\bMRIs?\b"),
                      ("grant", r"\bgrants?\b"), ("equity", r"\bequity\b"),
                      ("debt", r"\bloans?\b|\bdebt\b"), ("guarantee", r"\bguarantees?\b"),
                      ("prize", r"\bprize\b|\baward\b")):
        rx = re.compile(pat, re.I if inst not in ("pri", "mri") else 0)
        if rx.search(text):
            instruments.append(inst)  # type: ignore[arg-type]
            if not any(e.field == "instruments" for e in evidence):
                ev = _excerpt(text, rx, "instruments")
                if ev:
                    evidence.append(ev)
    if "impact invest" in low and "mri" not in instruments and "equity" not in instruments:
        instruments.append("unspecified")

    sectors: list[Sector] = []
    for sector, pat in _SECTOR_WORDS:
        if re.search(pat, low):
            sectors.append(sector)
            if not any(e.field == "sectors" for e in evidence):
                ev = _excerpt(text, re.compile(pat, re.I), "sectors")
                if ev:
                    evidence.append(ev)
    sectors = sectors[:4]

    horizon = None
    hm = re.search(r"through (20\d{2})", low)
    if hm:
        horizon = f"{hm[1]}-12-31"
        evidence.append(Evidence(field="horizon_end", excerpt=text[hm.start():hm.end() + 1]))

    if article.title:
        evidence.append(Evidence(field="headline", excerpt=article.title[:240]))

    is_signal = signal_type != "other" or amount is not None
    thin = len(article.text) < 200
    if thin or not is_signal:
        relevance: Relevance = "none" if thin else "low"
    elif signal_type in ("capital_commitment", "program_launch", "rfp_open", "deadline", "strategy_shift"):
        relevance = "high"
    else:
        relevance = "medium"

    who = publisher_hint or "The publisher"
    label = signal_type.replace("_", " ")
    amount_phrase = f" of ${amount:,.0f}" if amount else ""
    summary = (f"{who} page classified by the mock classifier as '{label}'{amount_phrase}. "
               f"Mock mode uses keyword rules; the summary is not a reading of the page.")
    cls = SignalClassification(
        is_funding_signal=is_signal and not thin, relevance=relevance,
        headline=article.title, published_at=article.published_at.isoformat() if article.published_at else None,
        signal_type=signal_type, amount_usd=amount, amount_kind=amount_kind if amount else None,
        instruments=list(dict.fromkeys(instruments)), eligible_recipients=list(dict.fromkeys(recipients)),
        sectors=sectors, geographies=[], horizon_end=horizon, summary=summary, action_hint=None,
        mentioned_orgs=[], evidence=evidence, confidence=0.35,
    )
    verified, violations = verify_evidence(cls, article)
    return ClassifyResult(verified, "mock", violations)


def classify(article: Article, publisher_hint: str | None, *, mode: str, model: str,
             api_key: str | None) -> ClassifyResult:
    if mode == "mock":
        return classify_mock(article, publisher_hint)
    return classify_live(article, publisher_hint, model=model, api_key=api_key)


def parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None

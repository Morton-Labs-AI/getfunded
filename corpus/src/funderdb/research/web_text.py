"""Versioned HTML text and labelled EIN extraction; never entity approval."""
from __future__ import annotations

import re

LEGACY_EXTRACTOR = "lxml-visible-text/v1"
CURRENT_EXTRACTOR = "lxml-visible-text/v2"
INERT_TAGS = {"script", "style", "noscript", "svg"}
BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "body", "br", "caption", "dd",
    "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption", "figure",
    "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr",
    "html", "legend", "li", "main", "nav", "ol", "p", "pre", "section",
    "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
}
LEGACY_EIN_PATTERN = re.compile(
    r"\b(?:EIN|Employer Identification Number|Tax\s*(?:ID|Identification)(?:\s*Number)?)"
    r"\s*[:#]?\s*(\d{2}[-\s]?\d{7})\b", re.I)
_LABEL = r"(?:EIN|Employer\s+Identification\s+Number|Tax\s*(?:ID|Identification)(?:\s*Number)?)"
EIN_PATTERN = re.compile(
    rf"\b{_LABEL}\b(?:\s+(?:number|no\.?))?"
    rf"(?:\s+or\s+{_LABEL}\b)?\s*\)?(?:\s+is)?\s*[:#?]?\s*"
    r"([0-9]{2}[-\s]?[0-9]{7})(?!\w|-[0-9])", re.I)


def visible_text(doc, version: str = CURRENT_EXTRACTOR) -> str:
    """Separate structural elements; preserve inline word/identifier fragments.

    V1 intentionally retains historical concatenation for saved citation hashes.
    This is static HTML text, not a claim about CSS visibility or rendered layout.
    """
    if version == LEGACY_EXTRACTOR:
        return " ".join(doc.text_content().split())
    if version != CURRENT_EXTRACTOR:
        raise ValueError(f"unsupported source extractor: {version}")
    parts = []

    def visit(node):
        if not isinstance(node.tag, str) or node.tag in INERT_TAGS:
            return
        block = node.tag in BLOCK_TAGS
        if block:
            parts.append(" ")
        if node.text:
            parts.append(node.text)
        for child in node:
            visit(child)
            if child.tail:
                parts.append(child.tail)
        if block:
            parts.append(" ")

    visit(doc)
    return " ".join("".join(parts).split())


def ein_mentions(text: str, version: str = CURRENT_EXTRACTOR) -> list[dict]:
    if version not in {LEGACY_EXTRACTOR, CURRENT_EXTRACTOR}:
        raise ValueError(f"unsupported source extractor: {version}")
    pattern = LEGACY_EIN_PATTERN if version == LEGACY_EXTRACTOR else EIN_PATTERN
    return [{"ein": re.sub(r"\D", "", match[1]), "start": match.start(),
             "end": match.end(), "excerpt": match[0]}
            for match in pattern.finditer(text)]

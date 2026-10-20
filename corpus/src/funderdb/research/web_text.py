"""Versioned HTML text and labelled EIN extraction; never entity approval."""
from __future__ import annotations

import re

LEGACY_EXTRACTOR = "lxml-visible-text/v1"
BOUNDARY_EXTRACTOR = "lxml-visible-text/v2"
CURRENT_EXTRACTOR = "lxml-visible-text/v3"
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
    if version not in {BOUNDARY_EXTRACTOR, CURRENT_EXTRACTOR}:
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


def ein_mentions(text: str, version: str = CURRENT_EXTRACTOR, doc=None) -> list[dict]:
    if version not in {LEGACY_EXTRACTOR, BOUNDARY_EXTRACTOR, CURRENT_EXTRACTOR}:
        raise ValueError(f"unsupported source extractor: {version}")
    pattern = LEGACY_EIN_PATTERN if version == LEGACY_EXTRACTOR else EIN_PATTERN
    mentions = [{"ein": re.sub(r"\D", "", match[1]), "start": match.start(),
             "end": match.end(), "excerpt": match[0]}
            for match in pattern.finditer(text)]
    if version != CURRENT_EXTRACTOR:
        return mentions
    mentions = [m for m in mentions if m["ein"] != "000000000"]
    if doc is None:
        return mentions
    # A column label applies only to cells in the same simple, explicit table.
    # Ambiguous merged/nested grids are intentionally left for review.
    for table in doc.xpath("//table"):
        if any(a.tag in INERT_TAGS for a in table.iterancestors()):
            continue
        column = name_column = width = None
        for row_index, row in enumerate(table.xpath("./tr|./thead/tr|./tbody/tr|./tfoot/tr")):
            cells = row.xpath("./th|./td")
            if not cells or any(c.get("colspan", "1") != "1" or c.get("rowspan", "1") != "1"
                                or c.xpath(".//table") for c in cells):
                column = None
                continue
            values = [visible_text(c) for c in cells]
            labels = [i for i, value in enumerate(values) if re.fullmatch(_LABEL, value, re.I)]
            if labels and (row_index == 0 or row.getparent().tag == "thead"
                           or any(c.tag == "th" for c in cells)):
                column = labels[0] if len(labels) == 1 else None
                width = len(cells)
                names = [i for i, value in enumerate(values) if re.fullmatch(
                    r"(?:legal\s+)?(?:organization(?:\s+name)?|name|entity|nonprofit(?:\s+name)?)", value, re.I)]
                name_column = names[0] if len(names) == 1 else None
                continue
            if column is None or len(cells) != width:
                continue
            value = values[column]
            if not re.fullmatch(r"[0-9]{2}[- ]?[0-9]{7}", value):
                continue
            ein = re.sub(r"\D", "", value)
            if ein == "000000000":
                continue
            row_text = visible_text(row)
            row_start = text.find(row_text)
            cell_offset = sum(len(v) + 1 for v in values[:column])
            start = row_start + cell_offset
            if row_start < 0 or text[start:start + len(value)] != value:
                continue
            if any(m["ein"] == ein and m["start"] <= start < m["end"] for m in mentions):
                continue
            mentions.append({"ein": ein, "start": start, "end": start + len(value),
                             "excerpt": value, "method": "explicit_ein_table_column",
                             "entity_label": values[name_column] if name_column is not None else None,
                             "entity_context": row_text, "table_xpath": table.getroottree().getpath(table),
                             "row_xpath": row.getroottree().getpath(row),
                             "span_locator": "first_literal_row_occurrence"})
    # Retain local entity assertions, rather than treating every page EIN as its owner.
    contexts = {}
    for node in doc.xpath("//p|//address|//li|//td|//div[not(div) and not(p)]"):
        if any(a.tag in INERT_TAGS for a in node.iterancestors()):
            continue
        value = visible_text(node)
        if not 20 <= len(value) <= 900:
            continue
        found = {re.sub(r"\D", "", m[1]) for m in EIN_PATTERN.finditer(value)}
        if len(found) == 1:
            ein = next(iter(found))
            if ein not in contexts or len(value) < len(contexts[ein]):
                contexts[ein] = value
    for mention in mentions:
        if "entity_context" not in mention:
            mention["entity_context"] = contexts.get(mention["ein"], "")
            mention["method"] = "labelled_ein"
    return sorted(mentions, key=lambda m: (m["start"], m["end"]))

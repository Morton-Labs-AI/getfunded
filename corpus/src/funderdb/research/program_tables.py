"""Bounded HTML table geometry and exact DOM/text citations; no entity approval."""
from __future__ import annotations

from bisect import bisect_right
import re

from .web_text import BLOCK_TAGS, INERT_TAGS, LEGACY_EXTRACTOR, visible_text


def source_spans(doc, page: dict) -> dict:
    """Map each DOM node to its actual occurrence in the saved normalized text."""
    chunks, bounds, size = [], {}, 0

    def append(text):
        nonlocal size
        chunks.append(text)
        size += len(text)

    def visit(node):
        if not isinstance(node.tag, str) or node.tag in INERT_TAGS:
            return
        begin = size
        block = page['extractor'] != LEGACY_EXTRACTOR and node.tag in BLOCK_TAGS
        if block:
            append(' ')
        if node.text:
            append(node.text)
        for child in node:
            visit(child)
            if child.tail:
                append(child.tail)
        if block:
            append(' ')
        bounds[node] = (begin, size)

    visit(doc)
    raw = ''.join(chunks)
    tokens = list(re.finditer(r'\S+', raw))
    if ' '.join(t[0] for t in tokens) != page['text']:
        return {}
    starts = [t.start() for t in tokens]
    normalized, cursor = [], 0
    for t in tokens:
        normalized.append(cursor)
        cursor += len(t[0]) + 1
    spans = {}
    for node, (a, b) in bounds.items():
        while a < b and raw[a].isspace():
            a += 1
        while b > a and raw[b - 1].isspace():
            b -= 1
        if a == b:
            continue
        first, last = bisect_right(starts, a) - 1, bisect_right(starts, b - 1) - 1
        start = normalized[first] + a - starts[first]
        end = normalized[last] + b - starts[last]
        text = visible_text(node, page['extractor'])
        if page['text'][start:end] == text:
            spans[node] = {'start': start, 'end': end, 'excerpt': text,
                           'locator': node.getroottree().getpath(node),
                           'source_url': page['url'], 'snapshot_sha256': page['snapshot']['sha256'],
                           'text_sha256': page['text_sha256']}
    return spans


def event_kind(text: str) -> str | None:
    if re.search(r'webinar|interview|notification|invitation|decision|review|meeting|performance|project (?:start|period)', text, re.I):
        return 'other_date'
    if re.search(r'\b(?:deadline|closing date)s?\b', text, re.I):
        return 'deadline'
    if re.search(r'\b(?:application|proposal|LOI).{0,30}(?:open|start)', text, re.I):
        return 'opening'
    return None


def table_grids(doc) -> dict:
    """Expand literal row/column spans once; reject malformed or oversized grids."""
    result = {}
    for table in doc.xpath('//table'):
        rows = table.xpath('./tr|./thead/tr|./tbody/tr|./tfoot/tr')
        slots, boxes = {}, {}
        valid = 0 < len(rows) <= 200 and not table.xpath('.//table')
        for r, row in enumerate(rows if valid else []):
            c = 0
            for cell in row.xpath('./th|./td'):
                while (r, c) in slots:
                    c += 1
                try:
                    width, height = int(cell.get('colspan', '1')), int(cell.get('rowspan', '1'))
                except ValueError:
                    valid = False
                    break
                if not (1 <= width <= 64 and 1 <= height <= 200 and c + width <= 64 and r + height <= len(rows)):
                    valid = False
                    break
                positions = [(rr, cc) for rr in range(r, r + height) for cc in range(c, c + width)]
                if any(pos in slots for pos in positions):
                    valid = False
                    break
                for pos in positions:
                    slots[pos] = cell
                boxes[cell] = (r, c, height, width)
                c += width
            if not valid:
                break
        result[table] = {'slots': slots if valid else {}, 'boxes': boxes if valid else {},
                         'status': 'bounded_literal_grid' if valid else 'unsupported_or_ambiguous_grid',
                         'locator': table.getroottree().getpath(table)}
    return result


def table_context(node, grids: dict, spans: dict) -> tuple[dict | None, dict | None]:
    cells = node.xpath('ancestor-or-self::td|ancestor-or-self::th')
    if not cells:
        return None, None
    cell = cells[-1]
    tables = cell.xpath('ancestor::table[1]')
    grid = grids[tables[0]] if tables else None
    if not grid or cell not in grid['boxes']:
        return None, {'status': 'unsupported_or_ambiguous_grid'}
    r, c, height, width = grid['boxes'][cell]
    info = {'status': grid['status'], 'table_locator': grid['locator'], 'row': r,
            'column': c, 'rowspan': height, 'colspan': width, 'subject_identity': 'not_adjudicated'}
    headers = []
    explicit = cell.get('headers', '').split()
    if explicit:
        for identifier in explicit:
            matches = [n for n in grid['boxes'] if n.get('id') == identifier]
            if len(matches) != 1:
                return None, {**info, 'status': 'ambiguous_explicit_headers'}
            headers.append((matches[0], -1))
    else:
        for header, (hr, hc, hh, hw) in grid['boxes'].items():
            if header is cell:
                continue
            scope = header.get('scope', '')
            is_column = header.tag == 'th' and scope not in {'row', 'rowgroup'} and hr < r and hc <= c and hc + hw >= c + width
            is_row = (header.tag == 'th' or (hr == r and hc == 0)) and scope not in {'col', 'colgroup'} and hr <= r < hr + hh and hc + hw <= c
            if is_column or is_row:
                headers.append((header, r - hr if is_column else 0))
    candidates = [(priority, h, event_kind(spans[h]['excerpt'])) for h, priority in headers
                  if h in spans and 0 < len(spans[h]['excerpt']) <= 240 and event_kind(spans[h]['excerpt'])]
    # Retain the row's subject literally; never equate it to the page owner.
    subjects = [h for h, (hr, hc, hh, hw) in grid['boxes'].items()
                if hc == 0 and hr <= r < hr + hh and hc + hw <= c and h in spans]
    if subjects:
        info['row_subject'] = spans[subjects[-1]]
    if not candidates:
        return None, {**info, 'event_attribution': 'unknown'}
    closest = min(x[0] for x in candidates)
    selected = [x for x in candidates if x[0] == closest]
    if len({x[2] for x in selected}) != 1:
        return None, {**info, 'event_attribution': 'ambiguous_header_kinds'}
    _, header, kind = selected[0]
    return {**spans[header], 'event_lead': kind, 'basis': 'table_cell_grid'}, info


def section_context(node, spans: dict) -> dict | None:
    anchor = node
    while anchor.getparent() is not None and anchor.getparent().tag in {'li', 'ul', 'ol'}:
        anchor = anchor.getparent()
    for sibling in anchor.itersiblings(preceding=True):
        text = spans.get(sibling, {}).get('excerpt', '')
        label = sibling.tag in {'h1', 'h2', 'h3', 'h4'} or (sibling.tag == 'p' and sibling.xpath('./strong|./b') and event_kind(text))
        if label:
            kind = event_kind(text)
            return {**spans[sibling], 'event_lead': kind, 'basis': 'nearest_sibling_heading'} if kind and 0 < len(text) <= 240 else None
        if sibling.tag not in {'p', 'li'} or len(text) > 240:
            break
    return None

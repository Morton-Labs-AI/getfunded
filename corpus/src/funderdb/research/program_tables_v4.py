"""Invitation/actor header roles; prior geometry and citation versions remain unchanged."""
from __future__ import annotations

import re
from .program_tables import source_spans, table_grids


def event_kind(text: str) -> str | None:
    from .event_subjects_v2 import eligibility_text, non_grant_activity
    from .program_tables_v2 import event_kind as prior_kind
    masked, _ = eligibility_text(text)
    return 'other_date' if non_grant_activity(masked) else prior_kind(masked)


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

"""Bounded nested heading attribution; unchanged table-grid and citation mapping."""
from __future__ import annotations
from .program_tables_v4 import source_spans, table_grids, table_context, event_kind

HEADINGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
BOUNDARIES = {'main', 'section', 'article', 'body', 'table', 'td', 'th'}


def _label(node, spans):
    if node.tag in HEADINGS:
        return node
    if node.tag == 'p' and node.xpath('./strong|./b'):
        return node
    # Wrappers may contain one label, but never a sibling program's schedule.
    labels = [h for h in node.iterdescendants() if h.tag in HEADINGS]
    if len(labels) == 1 and spans.get(node, {}).get('excerpt') == spans.get(labels[0], {}).get('excerpt'):
        return labels[0]
    return None


def section_context(node, spans: dict) -> dict | None:
    from .programs_v5 import SINGLE, RANGE
    anchor = node
    for depth in range(6):
        siblings = [s for s in anchor.itersiblings(preceding=True) if isinstance(s.tag, str)]
        for sibling in siblings[:8]:
            text = spans.get(sibling, {}).get('excerpt', '')
            label = _label(sibling, spans)
            if label is not None:
                span = spans.get(label)
                if not span or not 0 < len(span['excerpt']) <= 240:
                    return None
                kind = event_kind(span['excerpt'])
                return {**span, 'event_lead': kind, 'basis': 'bounded_nested_heading',
                        'ancestor_levels': depth} if kind else None
            # Only date-only siblings are transparent. Unrelated prose, multiple
            # labels, and a complete neighboring schedule stop inheritance.
            rest = RANGE.sub('', SINGLE.sub('', text)).strip(' ,;:-–—')
            if not text or len(text) > 240 or rest:
                return None
        if len(siblings) > 8 or anchor.getparent() is None or anchor.getparent().tag in BOUNDARIES:
            return None
        anchor = anchor.getparent()
    return None

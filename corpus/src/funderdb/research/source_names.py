"""Literal publisher names and occurrence-local entity declarations from HTML."""
from __future__ import annotations
import re

_GENERIC = re.compile(r'^(?:home|about(?: us)?|contact(?: us)?|welcome|news|donate|our mission)$', re.I)
_CAPITAL_NAME = r"([A-Z][\w’'&.-]*(?:\s+(?:[A-Z][\w’'&.-]*|of|the|and|for)){1,14})"
_DECLARATIONS = [
    re.compile(_CAPITAL_NAME + r'\s+(?:is\s+)?(?:a|an)\s+(?:registered\s+)?501\s*\(?\s*c', re.U),
    re.compile(_CAPITAL_NAME + r'\s*\((?:Federal\s+)?Tax\s*(?:ID|Identification)', re.U),
]


def declared_name(text: str) -> str | None:
    matches = [m for rx in _DECLARATIONS for m in rx.finditer(text)]
    return max(matches, key=lambda m: m.end()).group(1) if matches else None


def publisher_names(doc) -> list[dict]:
    names = []
    for node in doc.xpath('//title|//h1|//meta[@property="og:site_name"]|//meta[@name="application-name"]')[:40]:
        value = node.get('content') if node.tag == 'meta' else ''.join(node.itertext())
        for part in re.split(r'\s*\|\s*|\s+[–—-]\s+', value or ''):
            part = ' '.join(part.split())
            if 8 <= len(part) <= 160 and not _GENERIC.fullmatch(part) and part not in [n['value'] for n in names]:
                names.append({'value': part, 'xpath': node.getroottree().getpath(node),
                              'scope': 'publisher display-name assertion, not approved legal alias'})
    return names


def scoped_mentions(doc, text: str, mentions: list[dict], render) -> list[dict]:
    """Keep name-rich single-EIN blocks and literal sibling headings per occurrence."""
    identifiers = {m['ein'] for m in mentions}
    contexts = []
    for node in doc.xpath('//p|//address|//li|//footer|//section|//div'):
        if any(a.tag in {'script', 'style', 'noscript', 'svg'} for a in node.iterancestors()):
            continue
        raw = ''.join(node.itertext())
        if not 20 <= len(raw) <= 1800:
            continue
        found = {re.sub(r'\D', '', m[0]) for m in re.finditer(r'[0-9]{2}[- ]?[0-9]{7}', raw)} & identifiers
        if len(found) != 1:
            continue
        value = render(node)
        label = declared_name(value)
        heading = node.xpath('preceding-sibling::*[self::h1 or self::h2 or self::h3][1]')
        if not label and heading:
            h = ' '.join(heading[0].itertext()).strip()
            if 8 <= len(h) <= 140 and re.search(r'Foundation|Trust|Committee|Association|Society|Charity|Church|Hospital', h):
                label = h
        contexts.append((next(iter(found)), value, label, node.getroottree().getpath(node)))
    previous_end = 0
    for mention in mentions:
        if mention.get('method') == 'explicit_ein_table_column':
            previous_end = mention['end']
            continue
        options = []
        for ein, value, label, xpath in contexts:
            if ein != mention['ein']:
                continue
            start = text.find(value, max(0, mention['start'] - len(value)))
            if start >= 0 and start <= mention['start'] and mention['end'] <= start + len(value):
                options.append((not bool(label), len(value), value, label, start, xpath))
        if options:
            _, _, value, label, start, xpath = min(options)
            mention.update(entity_context=value, entity_label=label, context_start=start,
                           context_end=start + len(value), context_xpath=xpath)
        else:
            # Adjacent legal declarations in a shared footer need separate scopes.
            start = max(previous_end, mention['start'] - 500)
            value = text[start:mention['end']]
            mention.update(entity_context=value, entity_label=declared_name(value),
                           context_start=start, context_end=mention['end'], context_xpath=None)
        previous_end = mention['end']
    return mentions

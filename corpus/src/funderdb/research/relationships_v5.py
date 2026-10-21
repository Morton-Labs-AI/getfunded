"""Experimental literal alias and inter-entity evidence; never legal approval."""
from __future__ import annotations

import re

from .identity import _name, _named, identity_gate

_RELATION = re.compile(
    r'\b(?:supports?|supporting|affiliate[ds]?|subsidiar\w*|division|'
    r'operates?|operating|program(?:me)?\s+of|part\s+of|separate\s+(?:legal|corporate)|'
    r'fiscal\s+sponsor|grant(?:s|making)?\s+(?:to|from)|partners?\s+with)\b', re.I)
_DBA = re.compile(r'\b(?:d\.?\s*b\.?\s*a\.?|doing\s+business\s+as)\b', re.I)
_TAX = re.compile(r'501\s*\(?\s*c', re.I)
_WORD = r"[A-Z][\w’'&.-]*"
_ENTITY = rf"({_WORD}(?:\s+(?:{_WORD}|of|the|and|for|&)){{0,17}})"
_ENDINGS = [
    re.compile(_ENTITY + r"(?:[’']s)?\s+(?:Federal\s+)?(?:EIN|Tax\s*(?:ID|Identification))\b"),
    re.compile(_ENTITY + r'\s*,?\s+(?:is\s+)?(?:a|an)\s+(?:registered\s+)?501\s*\(?\s*c'),
    re.compile(_ENTITY + r'\s+(?:Nonprofit\s+)?501\s*\(?\s*c'),
    re.compile(_ENTITY + r'\s*[-–—]\s*(?:EIN|Tax\s*ID)\b'),
]


def explicit_entity_label(context: str) -> str | None:
    """A literal declaration before the identifier, without inferring aliases."""
    hits = [m for rx in _ENDINGS for m in rx.finditer(context)]
    if not hits:
        return None
    return max(hits, key=lambda m: m.end())[1].strip()


def enrich_mentions(text: str, mentions: list[dict]) -> list[dict]:
    for mention in mentions:
        if mention.get('method') == 'explicit_ein_table_column':
            continue
        context = mention.get('entity_context') or ''
        # Preserve full source context; resolve the legal subject before this EIN.
        end = mention['end'] - (mention.get('context_start') or 0)
        prefix = context[:end] if 0 < end <= len(context) else context
        label = explicit_entity_label(prefix)
        if label:
            mention['entity_label'] = label
        mention['declaration_prefix'] = prefix
    return mentions


def _literal(name: str, text: str) -> bool:
    normalized = _name(name)
    return bool(normalized) and (' ' + normalized + ' ') in (' ' + _name(text) + ' ')


def _initials(name: str) -> str:
    return ''.join(w[0] for w in _name(name).split() if w not in {'and', 'of', 'the', 'for'})


def _alias_proof(target: dict, page: dict, mention: dict, single_ein: bool) -> list[dict]:
    if mention['ein'] != target.get('ein') or mention.get('method') == 'explicit_ein_table_column':
        return []
    name = target.get('org_name') or ''
    context = mention.get('declaration_prefix') or mention.get('entity_context') or ''
    proofs = []
    # A short legal name is usable only beside an explicit DBA marker, not as a
    # short token match elsewhere on a page (e.g. an ambiguous acronym).
    for marker in _DBA.finditer(context):
        before = context[max(0, marker.start() - 160):marker.start()].strip()
        if _literal(name, before):
            proofs.append({'kind': 'explicit_dba', 'marker_start_in_context': marker.start(),
                           'marker_end_in_context': marker.end(), 'literal_context': context})
    local_label = mention.get('entity_label') or ''
    # Explicit full-name (initialism) declarations are source-backed edges,
    # even when the page title uses a different layout. Keep their literal span.
    for short in re.finditer(r'\(([^()]{3,80})\)', page['text']):
        before = page['text'][max(0, short.start() - 220):short.start()]
        if (_name(before).endswith(_name(name)) and _name(name)
                and _name(short[1]) == _name(local_label)):
            suffix = {'foundation', 'fund', 'trust', 'association', 'society'}
            compact = ''.join(w for w in _name(short[1]).split() if w not in suffix)
            full = ' '.join(w for w in _name(name).split() if w not in suffix)
            if 3 <= len(compact) <= 10 and compact == _initials(full):
                proofs.append({'kind': 'explicit_parenthesized_initialism',
                               'start': max(0, short.start() - 220), 'end': short.end(),
                               'excerpt': page['text'][max(0, short.start() - 220):short.end()]})
    names = page.get('publisher_names', [])
    for source in names:
        if _name(source['value']) != _name(name):
            continue
        local_label = mention.get('entity_label') or ''
        # A source title containing the complete legal name and a local
        # initialism declaration can establish a bounded publisher association.
        # This does not approve a general alias or permit fuzzy name overlap.
        words = _name(local_label).split()
        suffix = {'foundation', 'fund', 'trust', 'association', 'society'}
        short = ''.join(w for w in words if w not in suffix)
        full = ' '.join(w for w in _name(name).split() if w not in suffix)
        if (3 <= len(short) <= 10 and short == _initials(full)
                and _TAX.search(context)):
            proofs.append({'kind': 'exact_title_and_local_initialism',
                           'publisher_name': source, 'literal_context': context})
        # One-EIN publisher declaration: exact full legal name in source title,
        # tax assertion beside its sole identifier, no recipient/processor role.
        if (single_ein and (not local_label or _literal(name, local_label))
                and _TAX.search(context) and not re.search(
                r'\b(?:recipient|grantee|processor|fiscal\s+sponsor|on\s+behalf)\b', context, re.I)):
            proofs.append({'kind': 'exact_title_and_single_tax_declaration',
                           'publisher_name': source, 'literal_context': context})
    return proofs


def _relationships(pages: list[dict], left: str, right: str) -> list[dict]:
    if not left or not right or _name(left) == _name(right):
        return []
    evidence = []
    for page in pages:
        text = page['text']
        # Literal paragraph/sentence-sized windows; co-presence on a site or in
        # a directory is insufficient. Each endpoint and relation must occur.
        for relation in _RELATION.finditer(text):
            start, end = max(0, relation.start() - 300), min(len(text), relation.end() + 300)
            # Do not let an unrelated sentence's verb connect adjacent footer
            # declarations. Abbreviations may cause a conservative false hold.
            stops = list(re.finditer(r'[.!?;]\s+', text[start:relation.start()]))
            if stops:
                start += stops[-1].end()
            stop = re.search(r'[.!?;](?:\s+|$)', text[relation.end():end])
            if stop:
                end = relation.end() + stop.end()
            excerpt = text[start:end]
            if _literal(left, excerpt) and _literal(right, excerpt):
                evidence.append({'source_url': page['url'], 'snapshot_sha256': page['snapshot']['sha256'],
                                 'text_sha256': page['text_sha256'], 'start': start, 'end': end,
                                 'excerpt': excerpt, 'relation': relation[0],
                                 'scope': 'literal relationship assertion; not EIN or program equivalence'})
                break
    return evidence


def relationship_identity_gate(target: dict, pages: list[dict]) -> dict:
    # Reuse all existing hard guards. Only local-name and multi-entity holds are
    # reconsidered when there is new explicit evidence; no blanket override.
    result = identity_gate(target, pages, version='source-identity-gates/v1')
    blockers = set(result['blockers']) - {'publisher_name_not_locally_linked',
                                        'multiple_entities_require_scoped_review'}
    all_eins = {m['ein'] for p in pages for m in p.get('ein_mentions', [])}
    ein = target.get('ein');name = target.get('org_name') or ''
    assertions = [];target_labels = set();named_target = False
    for page in pages:
        for mention in page.get('ein_mentions', []):
            context = mention.get('declaration_prefix') or mention.get('entity_context') or ''
            label = mention.get('entity_label') or ''
            alias = _alias_proof(target, page, mention, len(all_eins) == 1)
            role = bool(re.search(r'\b(?:recipient|grantee|processor|on\s+behalf|fiscal\s+sponsor)\b', context, re.I))
            local_match = (_literal(name, label) if label else _named(_name(name), context)) or bool(alias)
            if mention['ein'] == ein and local_match and not role and mention.get('method') != 'explicit_ein_table_column':
                named_target = True
                if label:
                    target_labels.add(label)
                elif _named(_name(name), context):
                    target_labels.add(name)
            assertions.append({'ein': mention['ein'], 'entity_label': label or None,
                               'source_url': page['url'], 'snapshot_sha256': page['snapshot']['sha256'],
                               'text_sha256': page['text_sha256'], 'start': mention['start'], 'end': mention['end'],
                               'context': context, 'context_start': mention.get('context_start'),
                               'context_end': mention.get('context_end'), 'alias_evidence': alias,
                               'target_name_locally_present': local_match, 'other_role_language': role,
                               'table_row': mention.get('method') == 'explicit_ein_table_column'})
    if ein in all_eins and not named_target:
        blockers.add('publisher_name_not_locally_linked')
    relationships = []
    if len(all_eins) > 1:
        separate = named_target
        for other in all_eins - {ein}:
            labels = {a['entity_label'] for a in assertions if a['ein'] == other and a['entity_label']}
            links = [link for a in target_labels for b in labels for link in _relationships(pages, a, b)]
            relationships.extend({'from_ein': ein, 'to_ein': other, **link} for link in links)
            # A different name alone cannot clear an unexplained same-domain
            # publisher conflict. Require a literal inter-entity relationship.
            if not links:
                separate = False
        if not separate:
            blockers.add('multiple_entities_require_relationship_evidence')
    supported = bool(pages and ein in all_eins and named_target and not blockers)
    return {**result, 'schema': 'source-identity-gates/v3', 'candidate_supported': supported,
            'blockers': sorted(blockers), 'entity_assertions': assertions,
            'relationship_evidence': relationships,
            'filing_fallback_allowed': bool(pages and not all_eins and not blockers)}

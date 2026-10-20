"""Conservative source-role gates for identity hints, never website approval."""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlsplit

DIRECTORY_HOSTS = frozenset({
    'guidestar.org', 'candid.org', 'greatnonprofits.org', 'causeiq.com',
    'charitynavigator.org', 'grantfrog.com', 'tgci.com', 'instrumentl.com',
    'grantmakers.io', 'taxexemptworld.com', 'projects.propublica.org',
    'foundationcenter.org', 'nonprofitlocator.org', 'facebook.com',
    'linkedin.com', 'instagram.com',
})
TEMPORAL = re.compile(r'\b(?:dissolv\w*|supersed\w*|formerly|former\s+(?:EIN|entity)|'
                      r'prior\s+to\s+20\d\d|merg\w*|new\s+(?:legal\s+entity|501))\b', re.I)
OTHER_ROLE = re.compile(r'\b(?:recipient|grantee|funded\s+by|grant\s+from|partner|'
                        r'sponsor|fiscal|national|parent\s+organization)\b', re.I)


def _name(value: str) -> str:
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    return ' '.join(w for w in re.sub(r'[^a-z0-9]+', ' ', value).split()
                    if w not in {'the', 'inc', 'incorporated', 'ltd', 'corporation'})


def _named(name: str, text: str) -> bool:
    return len(name) >= 8 and (' ' + name + ' ') in (' ' + _name(text) + ' ')


def _source_alias(name: str, context: str, names: list[dict]) -> list[dict]:
    generic = {'foundation', 'fund', 'trust', 'charitable', 'charity', 'nonprofit',
               'organization', 'for', 'of', 'and', 'the', 'usa'}
    target = set(name.split()) - generic
    aliases = []
    for source in names:
        current = _name(source['value'])
        common = target & (set(current.split()) - generic)
        if (len(common) >= 2 or any(len(w) >= 6 for w in common)) and _named(current, context):
            if re.search(r'501\s*\(?\s*c', context, re.I):
                aliases.append(source)
    return aliases


def identity_gate(target: dict, pages: list[dict], version: str = 'source-identity-gates/v1') -> dict:
    """Gate only already checked same-host pages; retain each entity assertion.

    Exact legal-name locality is deliberately conservative. Unresolved multi-EIN
    context is held rather than forced into a shared domain identity. The filing
    fallback cannot override a role, placeholder, mismatch or temporal hold.
    """
    if version not in {'source-identity-gates/v1', 'source-identity-gates/v2'}:
        raise ValueError('unsupported identity gate version')
    blockers, scopes = set(), []
    urls = [target.get('website') or ''] + [p['url'] for p in pages]
    for url in urls:
        host = (urlsplit(url).hostname or '').lower().rstrip('.').removeprefix('www.')
        if any(host == d or host.endswith('.' + d) for d in DIRECTORY_HOSTS):
            blockers.add('directory_or_shared_platform')
    ein, name = target.get('ein'), _name(target.get('org_name') or '')
    if not ein or not re.fullmatch(r'[0-9]{9}', ein) or ein == '000000000':
        blockers.add('invalid_or_placeholder_target_ein')
    own_eins, named_target = set(), False
    for page in pages:
        if re.search(r'\b00[- ]?0000000\b', page['text']):
            blockers.add('placeholder_identifier_present')
        for mention in page.get('ein_mentions', []):
            observed = mention['ein']
            own_eins.add(observed)
            context = mention.get('entity_context') or ''
            local = page['text'][max(0, mention['start'] - 220):mention['end'] + 220]
            context_named = _named(name, context)
            if version == 'source-identity-gates/v2':
                context_named = context_named or _named(name, mention.get('entity_label') or '')
            aliases = (_source_alias(name, context, page.get('publisher_names', []))
                       if version == 'source-identity-gates/v2' and observed == ein else [])
            context_named = context_named or bool(aliases)
            association = context
            # For a single page EIN, adjacent name markup can still supply a
            # bounded literal association. Never use a name elsewhere on a site.
            if not context_named and len({m['ein'] for m in page['ein_mentions']}) == 1:
                context_named = _named(name, local)
                if context_named:
                    association = local
            is_table = mention.get('method') == 'explicit_ein_table_column'
            role_hold = bool(OTHER_ROLE.search(association))
            if observed == ein:
                if TEMPORAL.search(local) or TEMPORAL.search(context):
                    blockers.add('historical_or_succession_language')
                if context_named and not role_hold and not is_table:
                    named_target = True
            scopes.append({'ein': observed, 'entity_label': mention.get('entity_label'),
                           'context': context, 'source_url': page['url'],
                           'snapshot_sha256': page['snapshot']['sha256'],
                           'text_sha256': page['text_sha256'],
                           'start': mention['start'], 'end': mention['end'],
                           'target_name_locally_present': context_named,
                           **({'source_backed_aliases': aliases,
                               'context_start': mention.get('context_start'),
                               'context_end': mention.get('context_end'),
                               'context_xpath': mention.get('context_xpath')}
                              if version == 'source-identity-gates/v2' else {}),
                           'other_role_language': role_hold, 'table_row': is_table,
                           'interpretation': 'source assertion; entity role and current standing unapproved'})
    if own_eins and ein not in own_eins:
        blockers.add('publisher_target_ein_mismatch')
    if ein in own_eins and not named_target:
        blockers.add('publisher_name_not_locally_linked')
    if len(own_eins) > 1:
        # Each non-target assertion must carry a separate labelled entity row
        # or explicit other-entity role. Missing context is never a safe scope.
        others = [s for s in scopes if s['ein'] != ein]
        separate = all((s['entity_label'] and not _named(name, s['entity_label']))
                       or (s['other_role_language'] and not s['target_name_locally_present'])
                       for s in others)
        if not named_target or not separate:
            blockers.add('multiple_entities_require_scoped_review')
    supported = bool(pages and ein in own_eins and named_target and not blockers)
    return {'schema': version, 'candidate_supported': supported,
            'blockers': sorted(blockers), 'entity_assertions': scopes,
            'filing_fallback_allowed': bool(pages and not own_eins and not blockers),
            'semantic_review': 'pending', 'current_standing': 'not_checked',
            'human_reviewed': False, 'publication_approved': False,
            'application_status': 'awaiting_separate_application'}

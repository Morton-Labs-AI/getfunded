"""Literal event subjects and invitation qualifiers, never eligibility approval."""
from __future__ import annotations

import re

QUALIFIER = re.compile(
    r'\bby (?:prior |written )?invitation(?: only)?\b|\binvitation[- ]only\b|'
    r'\bonly invited (?:applicants|organizations|grantees)\b|'
    r'\bfor invited (?:applicants|organizations|grantees)\b|'
    r'\bif (?:you (?:are|were) |an organization is )?invited\b', re.I)
NON_GRANT_ACTIVITY = re.compile(
    r'\b(?:volunteer|board|committee|trustee|staff)\s+(?:committee\s+)?'
    r'(?:nominations?|positions?|recruitment|applications?|jobs?|hiring)\b|'
    r'\b(?:applications?|nominations?)\s+(?:for|to)\s+(?:the\s+)?'
    r'(?:board|committee|volunteer|trustee|staff)\b|'
    r'\b(?:employment|job applications?|volunteer registration|volunteer orientation)\b|'
    r'\b(?:donations?|charitable gifts?|fundraising|donor contributions?)\b', re.I)
GRANT_ACTIVITY = re.compile(
    r'\b(?:grant|scholarship|funding|LOI|proposal|letter of (?:intent|inquiry))\b'
    r'[^.;!?]{0,40}\b(?:application|deadline|due|submit|open)\w*|'
    r'\b(?:application|submit)\w*[^.;!?]{0,40}'
    r'\b(?:grant|scholarship|funding|LOI|proposal)\b', re.I)


def eligibility_text(text: str) -> tuple[str, list[dict]]:
    """Mask qualifiers only for cue matching; keep original source spans intact."""
    matches = list(QUALIFIER.finditer(text))
    chars = list(text)
    for hit in matches:
        chars[hit.start():hit.end()] = ' ' * len(hit[0])
    return ''.join(chars), [{'start_in_block': h.start(), 'end_in_block': h.end(),
                            'excerpt': h[0], 'role': 'eligibility_qualifier; not_eligibility_approval'}
                           for h in matches]


def non_grant_activity(text: str) -> dict | None:
    activities = list(NON_GRANT_ACTIVITY.finditer(text))
    grants = list(GRANT_ACTIVITY.finditer(text))
    if not activities or (grants and grants[-1].start() > activities[-1].start()):
        return None
    hit = activities[-1]
    return {'start_in_block': hit.start(), 'end_in_block': hit.end(), 'excerpt': hit[0],
            'role': 'non_grant_activity; actor_scope_review_pending'}

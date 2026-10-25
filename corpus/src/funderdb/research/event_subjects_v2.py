"""Nomination and post-award reporting subjects; literal roles, not eligibility approval."""
from __future__ import annotations
import re
from .event_subjects import eligibility_text, non_grant_activity as previous_activity

# A nomination is not a direct grant application, including cash awards. Do not
# infer that an award is honorific or monetary from its name.
NOMINATION = re.compile(r"\bnominations?\b", re.I)
REPORT = re.compile(
    r"\b(?:(?:final|interim|progress|grant|recipient|grantee|annual|financial|expenditure|outcome)[- ]+){1,3}reports?\b"
    r"|\breports?\s+(?:from|by|for)\s+(?:grant\s+)?recipients?\b", re.I)
APPLICATION = re.compile(
    r"\b(?:grant\s+)?(?:applications?|proposals?|LOIs?|letters? of (?:intent|inquiry))\b"
    r"[^.;!?]{0,45}\b(?:due|deadline|clos\w*|open\w*|submit\w*|receiv\w*|until|by)\b"
    r"|\b(?:submit\w*|receiv\w*|deadline for)\s+(?:grant\s+)?(?:applications?|proposals?|LOIs?)\b", re.I)


def non_grant_activity(text: str) -> dict | None:
    prior = previous_activity(text)
    candidates = [(m, 'nomination; award_type_unresolved') for m in NOMINATION.finditer(text)]
    candidates += [(m, 'recipient_reporting; obligation_scope_review_pending') for m in REPORT.finditer(text)]
    if not candidates:
        return prior
    hit, role = max(candidates, key=lambda x: x[0].start())
    applications = list(APPLICATION.finditer(text))
    # Attach a report/nomination date only when that subject follows the last
    # direct application cue. Materials preceding an application due date do
    # not turn the application into a reporting obligation.
    if applications and applications[-1].end() > hit.end():
        return prior
    if prior and prior['start_in_block'] > hit.start():
        return prior
    return {'start_in_block': hit.start(), 'end_in_block': hit.end(),
            'excerpt': hit[0], 'role': role}

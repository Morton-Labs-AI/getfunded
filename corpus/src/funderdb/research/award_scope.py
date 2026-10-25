"""Bounded literal recognition-submission scope, with monetary/mixed-scope holds."""
from __future__ import annotations
import re

AWARD = re.compile(r"\b(?:awards?|prizes?|honou?rs?)\b", re.I)
RECOGNITION = re.compile(r"\b(?:nominations?|recognition|recogniz(?:e|es|ing)\s+excellence|honou?rs?\s+(?:individuals?|excellence))\b", re.I)
SUBMISSION = re.compile(r"\b(?:submissions?|submit|eligible|deadline|nominations?)\b", re.I)
MONEY = re.compile(r"\$\s*\d|\b(?:cash|monetary|stipends?|honorari(?:um|a)|grants?|funding|scholarships?|fellowships?)\b", re.I)


def recognition_scope(text: str, date_count: int) -> dict | None:
    # A single short source unit only. Do not borrow recognition language across
    # multiple programs/dates or treat absence of a dollar amount as proof.
    # Scholarship in a literal scholarly-achievement list is not a cash award.
    # Mask only that narrow usage for money-cue matching, never for citations.
    monetary_text = re.sub(r'\bscholarship(?=,\s+(?:and\s+)?(?:public engagement|interpretation|research|innovation|creativity))',
                           lambda m: ' ' * len(m[0]), text, flags=re.I)
    if date_count != 1 or len(text) > 2200 or MONEY.search(monetary_text):
        return None
    award, recognition = AWARD.search(text), RECOGNITION.search(text)
    if not award or not recognition or not SUBMISSION.search(text):
        return None
    return {'role': 'recognition_submission; monetary_and_entity_scope_unapproved',
            'scope_basis': 'single_date_source_unit_with_explicit_recognition_language',
            'cues': [{'start_in_block': m.start(), 'end_in_block': m.end(), 'excerpt': m[0]}
                     for m in [award, recognition]]}

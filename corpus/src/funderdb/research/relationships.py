"""Add explicit identity evidence without replacing established v3 decisions."""
from __future__ import annotations

from .identity import identity_gate
from .relationships_v5 import relationship_identity_gate as strict_gate


def relationship_identity_gate(target: dict, pages: list[dict]) -> dict:
    if any('baseline_assertion' not in m for p in pages for m in p.get('ein_mentions', [])):
        raise ValueError('relationship gate v4 requires v6 source assertions')
    baseline_pages = [{**p, 'ein_mentions': [m['baseline_assertion']
                      for m in p.get('ein_mentions', [])]} for p in pages]
    baseline = identity_gate(target, baseline_pages, version='source-identity-gates/v1')
    strict = strict_gate(target, pages)
    hard = set(strict['blockers']) - {'publisher_name_not_locally_linked',
                                     'multiple_entities_require_relationship_evidence'}
    retained = baseline['candidate_supported'] and not hard
    soft_holds = strict['blockers'] if retained and not strict['candidate_supported'] else []
    return {**strict, 'schema': 'source-identity-gates/v4',
            'candidate_supported': bool(retained or strict['candidate_supported']),
            'blockers': sorted(hard) if retained else strict['blockers'],
            'additional_scope_review': soft_holds,
            'existing_v3_gate_supported': baseline['candidate_supported'],
            'new_evidence_added_hint': bool(strict['candidate_supported'] and not baseline['candidate_supported']),
            'baseline_identity_gate': baseline,
            'filing_fallback_allowed': baseline['filing_fallback_allowed'] and strict['filing_fallback_allowed']}
